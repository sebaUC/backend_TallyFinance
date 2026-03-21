import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export interface ConversationLogEntry {
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  tool?: string;
  action?: string;
  amount?: number;
  category?: string;
  txId?: string;
  mediaType?: string;
  mediaDesc?: string;
  channel: string;
}

/**
 * Tier 3 — Long-Term Memory.
 *
 * Fire-and-forget insert to `conversation_history` table in Supabase.
 * Never throws — logging failures should not break the bot.
 * Used for recall queries and long-term context beyond Redis TTL.
 */
@Injectable()
export class ConversationLogService {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  /**
   * Logs a user/assistant exchange to persistent storage.
   * Inserts two rows: one for user message, one for assistant response.
   */
  async logExchange(
    userEntry: ConversationLogEntry,
    assistantEntry: ConversationLogEntry,
  ): Promise<void> {
    try {
      const rows = [
        {
          user_id: userEntry.userId,
          role: 'user',
          content: userEntry.content,
          tool: null,
          action: null,
          amount: null,
          category: null,
          tx_id: null,
          media_type: userEntry.mediaType ?? null,
          media_desc: userEntry.mediaDesc ?? null,
          channel: userEntry.channel,
        },
        {
          user_id: assistantEntry.userId,
          role: 'assistant',
          content: assistantEntry.content,
          tool: assistantEntry.tool ?? null,
          action: assistantEntry.action ?? null,
          amount: assistantEntry.amount ?? null,
          category: assistantEntry.category ?? null,
          tx_id: assistantEntry.txId ?? null,
          media_type: null,
          media_desc: null,
          channel: assistantEntry.channel,
        },
      ];

      const { error } = await this.supabase
        .from('conversation_history')
        .insert(rows);

      if (error) {
        console.error(
          '[ConversationLogService] Failed to log:',
          error.message,
        );
      }
    } catch (err) {
      // Don't throw — logging failures should not break the bot
      console.error('[ConversationLogService] Exception:', err);
    }
  }
}
