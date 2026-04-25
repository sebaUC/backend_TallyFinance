// Preview render — refleja exactamente lo que envía sync-summary-builder.ts
// Inlina helpers para correr standalone sin compilar TS.

function formatChileTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
}
function formatChileDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit' });
  return `${date} ${formatChileTime(iso)}`;
}
function fmt(n) { return `$${Math.round(Math.abs(n)).toLocaleString('es-CL')}`; }
function escape(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function truncate(s, max) { return s.length <= max ? s : s.slice(0, max - 1) + '…'; }
function labelResolver(source) {
  switch (source) {
    case 'catalog':   return '<b>catalog</b> ✓ (match exacto en catálogo)';
    case 'trgm':      return '<b>trgm</b> ✓ (similitud difusa)';
    case 'embedding': return '<b>embedding</b> ✓ (significado semántico)';
    case 'llm':       return '<b>llm</b> ✓ (IA — comercio nuevo)';
    case 'none':      return '<b>none</b> ✗ (ningún resolver hizo match)';
    case null: case undefined: return '<i>sin resolver_source</i>';
    default: return `<b>${escape(source)}</b>`;
  }
}
function chileOffsetHoursFor(ymd) {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const parts = probe.toLocaleString('en-US', { timeZone: 'America/Santiago', timeZoneName: 'shortOffset' });
  const m = parts.match(/GMT([+-]\d+)/);
  return m ? parseInt(m[1], 10) : -4;
}
function extractFromRaw(raw) {
  if (!raw) return null;
  const m = raw.match(/el\s+(\d{2})\/(\d{2})\/(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const off = chileOffsetHoursFor(`${yyyy}-${mm}-${dd}`);
  const sign = off < 0 ? '-' : '+';
  const oh = String(Math.abs(off)).padStart(2, '0');
  return new Date(`${yyyy}-${mm}-${dd}T${hh.padStart(2,'0')}:${mi}:${ss ?? '00'}${sign}${oh}:00`).toISOString();
}
function effective(transactionAt, postedAt, raw) {
  const now = Date.now();
  if (transactionAt && new Date(transactionAt).getTime() <= now) return { iso: transactionAt, source: 'transaction_at', isFuture: false };
  const fr = extractFromRaw(raw);
  if (fr) return { iso: fr, source: 'raw_extracted', isFuture: false };
  if (postedAt) return { iso: postedAt, source: 'posted_at', isFuture: new Date(postedAt).getTime() > now };
  return { iso: null, source: 'none', isFuture: false };
}
function formatMovementTimestamp(transactionAt, postedAt, raw, withDate) {
  const f = withDate ? formatChileDateTime : formatChileTime;
  const eff = effective(transactionAt, postedAt, raw);
  if (!eff.iso) return '<i>(sin fecha)</i>';
  const time = `<b>${f(eff.iso)}</b>`;
  switch (eff.source) {
    case 'transaction_at': return `${time} <i>(real)</i>`;
    case 'raw_extracted': return `${time} <i>(real, extraída del banco)</i>`;
    case 'posted_at': return eff.isFuture
      ? `${time} ⚠️ <i>(banco postea con fecha futura)</i>`
      : `${time} <i>(post bancario)</i>`;
    default: return time;
  }
}
function formatMovementDebug(m) {
  const ts = formatMovementTimestamp(m.transactionAt, m.postedAt, m.rawDescription, false);
  const sign = m.type === 'income' ? '+' : '−';
  const amount = `${sign}${fmt(m.amount)}`;
  const merchantIcon = m.icon ? `${m.icon} ` : (m.type === 'income' ? '➕ ' : '🧾 ');
  const cat = m.categoryName ? escape(m.categoryName) : '<i>sin categoría</i>';
  const resolver = labelResolver(m.resolverSource);
  const raw = m.rawDescription ? `<code>${escape(truncate(m.rawDescription, 60))}</code>` : '<i>(sin raw)</i>';
  return [
    '',
    `${merchantIcon}<b>${amount}</b> · ${ts}`,
    `   📥 raw: ${raw}`,
    `   🔍 resolver: ${resolver}`,
    `   🏪 comercio: <b>${escape(m.merchantName)}</b>`,
    `   🏷️ categoría: ${cat}`,
  ].join('\n');
}
function buildResolverFooter(b, totalInserted) {
  const c=b.catalog??0,t=b.trgm??0,e=b.embedding??0,l=b.llm??0,n=b.none??0;
  const id=c+t+e+l;
  if (id+n===0) return null;
  const parts=[];
  if (c) parts.push(`${c} catálogo`);
  if (t) parts.push(`${t} similitud`);
  if (e) parts.push(`${e} significado`);
  if (l) parts.push(`${l} IA`);
  if (n) parts.push(`${n} sin match`);
  return `Resolver: ${parts.join(' · ')} (${id}/${totalInserted} resueltos)`;
}
function buildSyncSummary(input) {
  const lines = [];
  const bank = input.institutionName ? ` de ${escape(input.institutionName)}` : '';
  const time = formatChileTime(input.syncCompletedAt.toISOString());
  if (input.totalInserted > 0) {
    lines.push(`🏦 <b>Refresh${bank}</b> · ${time}`);
    lines.push('');
    const noun = input.totalInserted === 1 ? 'movimiento nuevo' : 'movimientos nuevos';
    lines.push(`📊 <b>${input.totalInserted}</b> ${noun}`);
    if (input.expenseCount > 0)
      lines.push(`💸 Gasto: ${fmt(input.totalSpent)} en ${input.expenseCount} ${input.expenseCount === 1 ? 'mov' : 'movs'}`);
    if (input.incomeCount > 0)
      lines.push(`💰 Ingreso: ${fmt(input.totalIncome)} en ${input.incomeCount} ${input.incomeCount === 1 ? 'mov' : 'movs'}`);
    if (input.newMovements.length > 0) {
      lines.push('');
      lines.push('<b>Detalle por movimiento:</b>');
      for (const m of input.newMovements.slice(0, 6)) lines.push(formatMovementDebug(m));
      if (input.newMovements.length > 6) {
        lines.push('');
        lines.push(`<i>… y ${input.newMovements.length - 6} más (cap del mensaje)</i>`);
      }
    }
    if (input.newMerchantsDiscovered.length > 0) {
      lines.push('');
      const names = input.newMerchantsDiscovered.slice(0, 5).map(escape).join(', ');
      const c = input.newMerchantsDiscovered.length;
      lines.push(`✨ Descubrí ${c} ${c === 1 ? 'comercio nuevo' : 'comercios nuevos'}: ${names}`);
    }
  } else {
    lines.push(`💳 <b>Refresh${bank}</b> · sync ${time}`);
    lines.push('');
    lines.push('🟢 Pipeline OK — webhook recibido, sync ejecutado, cero movs nuevos.');
    if (input.lastSeenTx) {
      const ts = formatMovementTimestamp(input.lastSeenTx.transactionAt, input.lastSeenTx.postedAt, input.lastSeenTx.rawDescription, true);
      const sign = input.lastSeenTx.type === 'income' ? '+' : '−';
      lines.push('');
      lines.push(`<b>Último mov visto:</b> ${escape(input.lastSeenTx.merchantName)} ${sign}${fmt(input.lastSeenTx.amount)}`);
      lines.push(`   ${ts}`);
    }
  }
  lines.push('');
  lines.push('<b>📅 Hoy:</b>');
  if (input.todayTotals.expenseCount > 0) {
    lines.push(`   Gasto: ${fmt(input.todayTotals.totalSpent)} en ${input.todayTotals.expenseCount} ${input.todayTotals.expenseCount === 1 ? 'mov' : 'movs'}`);
  } else {
    lines.push('   Gasto: $0');
  }
  if (input.todayTotals.incomeCount > 0) {
    lines.push(`   Ingreso: ${fmt(input.todayTotals.totalIncome)} en ${input.todayTotals.incomeCount} ${input.todayTotals.incomeCount === 1 ? 'mov' : 'movs'}`);
  }
  const footer = buildResolverFooter(input.resolverBreakdown, input.totalInserted);
  if (footer) {
    lines.push('');
    lines.push(`<i>${footer}</i>`);
  }
  return lines.join('\n');
}

function box(title, body) {
  const sep = '─'.repeat(72);
  console.log(`\n${sep}\n  ${title}\n${sep}`);
  console.log(body);
  console.log(sep + '\n');
}
// helpers de fechas para los escenarios
function dt(hh, mm) { // hoy en Chile a HH:MM
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  return new Date(`${today}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00-04:00`).toISOString();
}
function dtFuture(daysAhead, hh, mm) { // d días en el futuro a HH:MM Chile
  const base = new Date();
  base.setDate(base.getDate() + daysAhead);
  const ymd = base.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  return new Date(`${ymd}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00-04:00`).toISOString();
}

// ── CASO BICE-1 — heartbeat con BICE genérico (post futuro, igual que el bug) ──
box('CASO BICE-1 — heartbeat con BICE genérico (sin hora en raw)', buildSyncSummary({
  totalInserted: 0,
  totalSpent: 0, expenseCount: 0, totalIncome: 0, incomeCount: 0,
  topMerchants: [], newMovements: [], newMerchantsDiscovered: [],
  resolverBreakdown: {},
  institutionName: 'Banco BICE',
  todayTotals: { totalSpent: 3850, expenseCount: 1, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: {
    merchantName: 'Cargo Por Compra En Comercio Nac.',
    amount: 3850,
    type: 'expense',
    transactionAt: null,
    postedAt: dtFuture(1, 20, 0),
    rawDescription: 'Cargo por Compra en Comercio Nac.',
  },
  syncCompletedAt: new Date(),
}));

// ── CASO BICE-2 — BICE detallado (extrae hora del raw_description) ──
box('CASO BICE-2 — BICE detallado: hora REAL extraída del raw', buildSyncSummary({
  totalInserted: 1,
  totalSpent: 1764, expenseCount: 1, totalIncome: 0, incomeCount: 0,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'Lime Viajes Jkj', amount: 1764, type: 'expense',
      transactionAt: null,
      postedAt: '2026-04-24T00:00:00+00:00',
      icon: '🚗', resolverSource: 'trgm',
      // RAW REAL de la DB:
      rawDescription: 'Cargo por compra en LIME*VIAJE JKJ5   el 24/04/2026 a las 08:56:47 hrs., monto 1764.',
      categoryName: 'Transporte',
    },
  ],
  newMerchantsDiscovered: [],
  resolverBreakdown: { trgm: 1 },
  institutionName: 'Banco BICE',
  todayTotals: { totalSpent: 1764, expenseCount: 1, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO A — gasto con transaction_at real (caso ideal) ───────────
box('CASO A — gasto con transaction_at (hora real disponible)', buildSyncSummary({
  totalInserted: 1,
  totalSpent: 12500, expenseCount: 1, totalIncome: 0, incomeCount: 0,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'Lider', amount: 12500, type: 'expense',
      transactionAt: dt(14, 8),
      postedAt: dtFuture(3, 0, 0), // banco postea 3 días después
      icon: '🛒', resolverSource: 'catalog',
      rawDescription: 'COMPRA TBK*LIDER QUILICURA 2104',
      categoryName: 'Supermercado',
    },
  ],
  newMerchantsDiscovered: [],
  resolverBreakdown: { catalog: 1 },
  institutionName: 'Banco Estado',
  todayTotals: { totalSpent: 12500, expenseCount: 1, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO B — solo posted_at, ya pasado (transferencia normal) ─────
box('CASO B — sin transaction_at, posted en el pasado', buildSyncSummary({
  totalInserted: 1,
  totalSpent: 8900, expenseCount: 1, totalIncome: 0, incomeCount: 0,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'Transferencia', amount: 8900, type: 'expense',
      transactionAt: null,
      postedAt: dt(11, 15),
      icon: null, resolverSource: 'none',
      rawDescription: 'TRAS BANR EST 32918  ABONO PR',
      categoryName: null,
    },
  ],
  newMerchantsDiscovered: [],
  resolverBreakdown: { none: 1 },
  institutionName: 'Banco Estado',
  todayTotals: { totalSpent: 8900, expenseCount: 1, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO C — posted en el futuro (BICE bug visible en detalle) ────
box('CASO C — solo posted_at en futuro (warning visible)', buildSyncSummary({
  totalInserted: 1,
  totalSpent: 3850, expenseCount: 1, totalIncome: 0, incomeCount: 0,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'Cargo Por Compra En Comercio Nac.',
      amount: 3850, type: 'expense',
      transactionAt: null,
      postedAt: dtFuture(1, 20, 0),
      icon: null, resolverSource: 'none',
      rawDescription: 'CARGO POR COMPRA EN COMERCIO NAC.',
      categoryName: null,
    },
  ],
  newMerchantsDiscovered: [],
  resolverBreakdown: { none: 1 },
  institutionName: 'Banco BICE',
  todayTotals: { totalSpent: 3850, expenseCount: 1, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO D — heartbeat sin nada ───────────────────────────────────
box('CASO D — heartbeat absoluto', buildSyncSummary({
  totalInserted: 0,
  totalSpent: 0, expenseCount: 0, totalIncome: 0, incomeCount: 0,
  topMerchants: [], newMovements: [], newMerchantsDiscovered: [],
  resolverBreakdown: {},
  institutionName: null,
  todayTotals: { totalSpent: 0, expenseCount: 0, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));
