import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

interface AccountWithBalance {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  currentBalance: number;
}

interface BalanceData {
  unifiedBalance: boolean;
  totalBalance: number;
  totalSpent: number;
  totalIncome: number;
  accounts: AccountWithBalance[];
  activeBudget: {
    period: string;
    amount: number;
    remaining: number;
  } | null;
  periodLabel: string;
  // Filter context (so Phase B knows what was queried)
  filter?: {
    period?: string;
    category?: string;
    type?: string;
  };
}

/**
 * AskBalanceToolHandler - Queries user's balance from accounts + period spending.
 *
 * Requires context: true (needs accounts, transactions, budget)
 *
 * Features:
 * - Reads balance from accounts.current_balance (persistido)
 * - Shows period spending (expenses) and income separately
 * - With active budget: Shows remaining budget
 * - Supports filters: period (today/week/month/custom), category, type (expense/income/all)
 */
export class AskBalanceToolHandler implements ToolHandler {
  readonly name = 'ask_balance';

  readonly schema: ToolSchema = {
    name: 'ask_balance',
    description: 'Consulta el saldo actual de las cuentas del usuario',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description:
            'Período a consultar: "today", "week", "month" (default), "custom"',
        },
        start_date: {
          type: 'string',
          description:
            'Fecha inicio ISO-8601 (solo si period="custom")',
        },
        end_date: {
          type: 'string',
          description:
            'Fecha fin ISO-8601 (solo si period="custom")',
        },
        category: {
          type: 'string',
          description:
            'Filtrar por categoría específica (nombre exacto)',
        },
        type: {
          type: 'string',
          description:
            'Filtrar por tipo: "expense", "income", "all" (default "all")',
        },
      },
      required: [],
    },
  };

  readonly requiresContext = true;

  constructor(private readonly supabase: SupabaseClient) {}

  async execute(
    userId: string,
    _msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    try {
      const period = (args.period as string) ?? 'month';
      const filterCategory = args.category as string | undefined;
      const filterType = (args.type as string) ?? 'all';
      const customStart = args.start_date as string | undefined;
      const customEnd = args.end_date as string | undefined;

      // 1. Get user preferences (unifiedBalance)
      const { data: userPrefs, error: prefsError } = await this.supabase
        .from('user_prefs')
        .select('unified_balance')
        .eq('id', userId)
        .maybeSingle();

      if (prefsError) {
        console.error('[AskBalanceToolHandler] Prefs query error:', prefsError);
        return {
          ok: false,
          action: 'ask_balance',
          errorCode: 'DB_QUERY_FAILED',
          userMessage: 'Hubo un problema consultando tus preferencias.',
        };
      }

      const unifiedBalance = userPrefs?.unified_balance ?? true;

      // 2. Get user's accounts with balance
      const { data: accounts, error: accError } = await this.supabase
        .from('accounts')
        .select('id, name, institution, currency, current_balance')
        .eq('user_id', userId);

      if (accError) {
        console.error('[AskBalanceToolHandler] Accounts query error:', accError);
        return {
          ok: false,
          action: 'ask_balance',
          errorCode: 'DB_QUERY_FAILED',
          userMessage: 'Hubo un problema consultando tus cuentas.',
        };
      }

      if (!accounts?.length) {
        return {
          ok: true,
          action: 'ask_balance',
          userMessage:
            'Aún no tienes cuentas configuradas. Completa el onboarding desde la app web.',
        };
      }

      // 3. Calculate date range based on period
      const now = new Date();
      let startDate: Date;
      let endDate: Date;
      let periodLabel: string;

      switch (period) {
        case 'today': {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          periodLabel = 'hoy';
          break;
        }
        case 'week': {
          const dayOfWeek = now.getDay();
          const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
          periodLabel = 'esta semana';
          break;
        }
        case 'custom': {
          startDate = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = customEnd ? new Date(customEnd) : now;
          // Set end of day
          endDate.setHours(23, 59, 59);
          const startLabel = startDate.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
          const endLabel = endDate.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
          periodLabel = `${startLabel} al ${endLabel}`;
          break;
        }
        default: {
          // month
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
          periodLabel = now.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
          break;
        }
      }

      // 4. Resolve category filter to category_id
      let categoryId: string | undefined;
      if (filterCategory) {
        const { data: cat } = await this.supabase
          .from('categories')
          .select('id')
          .eq('user_id', userId)
          .ilike('name', filterCategory)
          .maybeSingle();
        categoryId = cat?.id;
      }

      // 5. Build query for expenses
      let totalSpent = 0;
      if (filterType !== 'income') {
        let expQuery = this.supabase
          .from('transactions')
          .select('amount')
          .eq('user_id', userId)
          .eq('type', 'expense')
          .gte('posted_at', startDate.toISOString())
          .lte('posted_at', endDate.toISOString());

        if (categoryId) {
          expQuery = expQuery.eq('category_id', categoryId);
        }

        const { data: periodExpenses, error: expError } = await expQuery;
        if (expError) {
          console.error('[AskBalanceToolHandler] Expenses query error:', expError);
        }
        totalSpent = (periodExpenses ?? []).reduce(
          (sum: number, tx: any) => sum + Number(tx.amount), 0,
        );
      }

      // 6. Build query for income
      let totalIncome = 0;
      if (filterType !== 'expense') {
        let incQuery = this.supabase
          .from('transactions')
          .select('amount')
          .eq('user_id', userId)
          .eq('type', 'income')
          .gte('posted_at', startDate.toISOString())
          .lte('posted_at', endDate.toISOString());

        if (categoryId) {
          incQuery = incQuery.eq('category_id', categoryId);
        }

        const { data: periodIncome, error: incError } = await incQuery;
        if (incError) {
          console.error('[AskBalanceToolHandler] Income query error:', incError);
        }
        totalIncome = (periodIncome ?? []).reduce(
          (sum: number, tx: any) => sum + Number(tx.amount), 0,
        );
      }

      // 7. Calculate total balance
      const totalBalance = accounts.reduce(
        (sum: number, a: any) => sum + Number(a.current_balance), 0,
      );

      // 8. Get active budget
      const { data: budget, error: budgetError } = await this.supabase
        .from('spending_expectations')
        .select('period, amount')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();

      if (budgetError) {
        console.error('[AskBalanceToolHandler] Budget query error:', budgetError);
      }

      let activeBudget: BalanceData['activeBudget'] = null;
      if (budget?.amount) {
        const budgetAmount = Number(budget.amount) || 0;
        activeBudget = {
          period: budget.period,
          amount: budgetAmount,
          remaining: budgetAmount - totalSpent,
        };
      }

      // 9. Return data for Phase B
      const balanceData: BalanceData = {
        unifiedBalance,
        totalBalance,
        totalSpent,
        totalIncome,
        accounts: accounts.map((a: any) => ({
          id: a.id,
          name: a.name,
          institution: a.institution,
          currency: a.currency,
          currentBalance: Number(a.current_balance),
        })),
        activeBudget,
        periodLabel,
        ...(period !== 'month' || filterCategory || filterType !== 'all'
          ? {
              filter: {
                period,
                category: filterCategory,
                type: filterType,
              },
            }
          : {}),
      };

      return {
        ok: true,
        action: 'ask_balance',
        data: balanceData,
      };
    } catch (err) {
      console.error('[AskBalanceToolHandler] Unexpected error:', err);
      return {
        ok: false,
        action: 'ask_balance',
        errorCode: 'UNEXPECTED_ERROR',
        userMessage: 'Hubo un error inesperado consultando tu balance.',
      };
    }
  }
}
