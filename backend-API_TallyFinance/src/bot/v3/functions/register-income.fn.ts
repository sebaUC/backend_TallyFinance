import { SupabaseClient } from '@supabase/supabase-js';

export async function registerIncome(
  supabase: SupabaseClient,
  userId: string,
  args: {
    amount: number;
    source?: string;
    posted_at?: string;
  },
): Promise<Record<string, any>> {
  const { amount } = args;
  const source = args.source || 'Ingreso';
  const postedAt =
    args.posted_at ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

  // Get default account
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!account) {
    return { ok: false, error: 'NO_ACCOUNT' };
  }

  // Insert as income transaction (no category)
  const { data: inserted, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      amount: Math.round(amount * 100) / 100,
      category_id: null,
      posted_at: postedAt,
      account_id: account.id,
      source: 'chat_intent',
      status: 'posted',
      type: 'income',
      name: source,
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: 'DB_INSERT_FAILED', message: error.message };
  }

  // Update account balance (add)
  await supabase.rpc('update_account_balance', {
    p_account_id: account.id,
    p_delta: Math.abs(amount),
  });

  return {
    ok: true,
    data: {
      id: inserted?.id,
      amount: Math.round(amount * 100) / 100,
      source,
      type: 'income',
      posted_at: postedAt,
    },
  };
}
