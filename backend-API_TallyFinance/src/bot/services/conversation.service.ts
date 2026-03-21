import { Injectable, Logger } from '@nestjs/common';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';
import { ActionBlock } from '../actions/action-block';

/**
 * Pending slot-fill state structure.
 * Stored as JSON in Redis with 10min TTL.
 */
export interface PendingSlot {
  tool: string;
  collectedArgs: Record<string, unknown>;
  missingArgs: string[];
  askedAt: string; // ISO timestamp
}

/**
 * Deterministic session summary — replaces AI-generated summaries.
 * Updated by the backend after each interaction. Never loses data.
 */
export interface SessionSummary {
  lastActivity: string;           // ISO timestamp
  todayTxCount: number;           // Transactions registered today
  todayTotalSpent: number;        // Total spent today (CLP)
  todayTotalIncome: number;       // Total income today (CLP)
  todayCategories: string[];      // Categories used today
  lastTool: string;               // Last tool executed
  lastAmount?: number;            // Last amount registered
  lastCategory?: string;          // Last category used
  lastTxId?: string;              // Last transaction ID
  lastTxType?: string;            // 'expense' | 'income'
  sessionTopics: string[];        // Topics touched: ['gastos', 'balance', 'metas']
  mediaReceived: number;          // Media received in session
  failedAttempts: number;         // Consecutive failed attempts (frustration detection)
}

/**
 * Conversation memory service.
 *
 * Manages two separate Redis keys per user:
 * - `conv:{userId}:summary` - Natural language TEXT summarizing recent context (2-24h TTL)
 * - `conv:{userId}:pending` - JSON slot-fill state for multi-turn tool completion (10m TTL)
 */
@Injectable()
export class ConversationService {
  private readonly log = new Logger(ConversationService.name);

  constructor(private readonly redis: RedisService) {}

  // =========================================================================
  // SUMMARY: Natural language context recap (TEXT STRING)
  // =========================================================================

  /**
   * Gets the conversation summary for a user.
   * @returns Summary text or null if not cached
   */
  async getSummary(userId: string): Promise<string | null> {
    const key = RedisKeys.convSummary(userId);
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.log.warn(`[getSummary] Redis error for user ${userId}`, err);
      return null;
    }
  }

  /**
   * Saves a conversation summary.
   * @param userId User ID
   * @param summary Natural language recap (e.g., "Usuario registró 3 gastos en comida...")
   * @param ttlHours TTL in hours (default 2, max 24)
   */
  async saveSummary(
    userId: string,
    summary: string,
    ttlHours: number = 2,
  ): Promise<void> {
    const key = RedisKeys.convSummary(userId);
    const ttl = Math.min(ttlHours, 24) * 3600;
    try {
      await this.redis.set(key, summary, ttl);
      this.log.debug(`[saveSummary] Saved summary for user ${userId}`);
    } catch (err) {
      this.log.warn(`[saveSummary] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Clears the conversation summary.
   */
  async clearSummary(userId: string): Promise<void> {
    const key = RedisKeys.convSummary(userId);
    try {
      await this.redis.del(key);
      this.log.debug(`[clearSummary] Cleared summary for user ${userId}`);
    } catch (err) {
      this.log.warn(`[clearSummary] Redis error for user ${userId}`, err);
    }
  }

  // =========================================================================
  // SESSION SUMMARY: Deterministic session context (JSON)
  // =========================================================================

  private static readonly EMPTY_SESSION: SessionSummary = {
    lastActivity: '',
    todayTxCount: 0,
    todayTotalSpent: 0,
    todayTotalIncome: 0,
    todayCategories: [],
    lastTool: '',
    sessionTopics: [],
    mediaReceived: 0,
    failedAttempts: 0,
  };

  /**
   * Gets the session summary. Returns a fresh empty summary if none exists.
   * Automatically resets daily counters if lastActivity was a different day.
   */
  async getSessionSummary(userId: string): Promise<SessionSummary> {
    const key = RedisKeys.convSummary(userId);
    try {
      const json = await this.redis.get(key);
      if (!json) return { ...ConversationService.EMPTY_SESSION };

      const summary = JSON.parse(json) as SessionSummary;

      // Reset daily counters if lastActivity was a different day (Chile timezone)
      if (summary.lastActivity) {
        const lastDate = new Date(summary.lastActivity).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
        const today = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
        if (lastDate !== today) {
          summary.todayTxCount = 0;
          summary.todayTotalSpent = 0;
          summary.todayTotalIncome = 0;
          summary.todayCategories = [];
        }
      }

      return summary;
    } catch (err) {
      this.log.warn(`[getSessionSummary] Redis error for user ${userId}`, err);
      return { ...ConversationService.EMPTY_SESSION };
    }
  }

  /**
   * Updates the session summary after a tool execution.
   * Deterministic — never depends on AI to generate correct data.
   */
  async updateSessionSummary(
    userId: string,
    update: {
      tool: string;
      success: boolean;
      amount?: number;
      category?: string;
      txId?: string;
      txType?: string; // 'expense' | 'income'
      hasMedia?: boolean;
    },
  ): Promise<SessionSummary> {
    const summary = await this.getSessionSummary(userId);
    const now = new Date().toISOString();

    summary.lastActivity = now;
    summary.lastTool = update.tool;

    if (update.success) {
      summary.failedAttempts = 0;

      // Track transaction data
      if (update.tool === 'register_transaction' && update.amount) {
        summary.todayTxCount += 1;
        if (update.txType === 'income') {
          summary.todayTotalIncome += update.amount;
        } else {
          summary.todayTotalSpent += update.amount;
        }
        summary.lastAmount = update.amount;
        summary.lastTxType = update.txType;
        if (update.txId) summary.lastTxId = update.txId;
        if (update.category) {
          summary.lastCategory = update.category;
          if (!summary.todayCategories.includes(update.category)) {
            summary.todayCategories.push(update.category);
          }
        }
      }

      // Track session topics
      const topicMap: Record<string, string> = {
        register_transaction: 'gastos',
        manage_transactions: 'transacciones',
        manage_categories: 'categorías',
        ask_balance: 'balance',
        ask_budget_status: 'presupuesto',
        ask_goal_status: 'metas',
        ask_app_info: 'info',
      };
      const topic = topicMap[update.tool];
      if (topic && !summary.sessionTopics.includes(topic)) {
        summary.sessionTopics.push(topic);
      }
    } else {
      summary.failedAttempts += 1;
    }

    if (update.hasMedia) {
      summary.mediaReceived += 1;
    }

    // Save with 24h TTL
    const key = RedisKeys.convSummary(userId);
    try {
      await this.redis.set(key, JSON.stringify(summary), RedisTTL.CONV_SUMMARY_DEFAULT);
      this.log.debug(`[updateSessionSummary] Updated for user ${userId}: tx=${summary.todayTxCount} failed=${summary.failedAttempts}`);
    } catch (err) {
      this.log.warn(`[updateSessionSummary] Redis error for user ${userId}`, err);
    }

    return summary;
  }

  // =========================================================================
  // PENDING: Slot-fill state for multi-turn tool completion (JSON)
  // =========================================================================

  /**
   * Gets pending slot-fill state.
   * @returns PendingSlot or null if no pending state
   */
  async getPending(userId: string): Promise<PendingSlot | null> {
    const key = RedisKeys.convPending(userId);
    try {
      const json = await this.redis.get(key);
      if (!json) return null;
      return JSON.parse(json) as PendingSlot;
    } catch (err) {
      this.log.warn(`[getPending] Redis error for user ${userId}`, err);
      return null;
    }
  }

  /**
   * Sets pending slot-fill state.
   * Automatically expires after 10 minutes if user abandons.
   */
  async setPending(userId: string, pending: PendingSlot): Promise<void> {
    const key = RedisKeys.convPending(userId);
    try {
      await this.redis.set(key, JSON.stringify(pending), RedisTTL.CONV_PENDING);
      this.log.debug(
        `[setPending] Set pending for user ${userId}: tool=${pending.tool}, missing=${pending.missingArgs.join(',')}`,
      );
    } catch (err) {
      this.log.warn(`[setPending] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Clears pending slot-fill state (after completion or explicit cancel).
   */
  async clearPending(userId: string): Promise<void> {
    const key = RedisKeys.convPending(userId);
    try {
      await this.redis.del(key);
      this.log.debug(`[clearPending] Cleared pending for user ${userId}`);
    } catch (err) {
      this.log.warn(`[clearPending] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Checks if user has pending slot-fill state.
   */
  async hasPending(userId: string): Promise<boolean> {
    const key = RedisKeys.convPending(userId);
    try {
      return await this.redis.exists(key);
    } catch (err) {
      this.log.warn(`[hasPending] Redis error for user ${userId}`, err);
      return false;
    }
  }

  // =========================================================================
  // ACTION BLOCK: Multi-action pipeline state (JSON)
  // =========================================================================

  /**
   * Gets the active ActionBlock for a user.
   * @returns ActionBlock or null if no active block
   */
  async getBlock(userId: string): Promise<ActionBlock | null> {
    const key = RedisKeys.convBlock(userId);
    try {
      const json = await this.redis.get(key);
      if (!json) return null;
      return JSON.parse(json) as ActionBlock;
    } catch (err) {
      this.log.warn(`[getBlock] Redis error for user ${userId}`, err);
      return null;
    }
  }

  /**
   * Saves an ActionBlock. TTL: 10 minutes.
   */
  async setBlock(userId: string, block: ActionBlock): Promise<void> {
    const key = RedisKeys.convBlock(userId);
    try {
      await this.redis.set(key, JSON.stringify(block), RedisTTL.CONV_BLOCK);
      this.log.debug(`[setBlock] Saved block ${block.id} for user ${userId} (${block.items.length} items)`);
    } catch (err) {
      this.log.warn(`[setBlock] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Clears the active ActionBlock (after completion or explicit cancel).
   */
  async clearBlock(userId: string): Promise<void> {
    const key = RedisKeys.convBlock(userId);
    try {
      await this.redis.del(key);
      this.log.debug(`[clearBlock] Cleared block for user ${userId}`);
    } catch (err) {
      this.log.warn(`[clearBlock] Redis error for user ${userId}`, err);
    }
  }
}
