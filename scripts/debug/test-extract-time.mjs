// Verifica que el extractor de hora del raw_description funciona con
// los patrones reales de Banco BICE observados en producción.

function chileOffsetHoursFor(ymd) {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const parts = probe.toLocaleString('en-US', { timeZone: 'America/Santiago', timeZoneName: 'shortOffset' });
  const m = parts.match(/GMT([+-]\d+)/);
  return m ? parseInt(m[1], 10) : -4;
}
function extract(raw) {
  if (!raw) return null;
  const m = raw.match(/el\s+(\d{2})\/(\d{2})\/(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const off = chileOffsetHoursFor(`${yyyy}-${mm}-${dd}`);
  const sign = off < 0 ? '-' : '+';
  const oh = String(Math.abs(off)).padStart(2, '0');
  const iso = `${yyyy}-${mm}-${dd}T${hh.padStart(2,'0')}:${mi}:${ss ?? '00'}${sign}${oh}:00`;
  return new Date(iso).toISOString();
}
function fmtChile(iso) {
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

const cases = [
  ['Cargo por compra en LIME*VIAJE JKJ5   el 24/04/2026 a las 08:56:47 hrs., monto 1764.', '24/04 08:56'],
  ['Cargo por compra en WORK CAFE TITANIU el 23/04/2026 a las 10:46:40 hrs., monto 5800.', '23/04 10:46'],
  ['Cargo por compra en TOTTUS KENNEDY II el 22/04/2026 a las 19:22:57 hrs., monto 26320.', '22/04 19:22'],
  ['Transferencia de SEBASTIAN ... el 22/04/2026 a las 19:22:50.', '22/04 19:22'],
  ['Cargo por compra en CLAUDE.AI SUBSCRI el 21/04/2026 a las 19:40:53 hrs., monto 21182.', '21/04 19:40'],
  ['Cargo por compra en ARAMCO            el 18/04/2026 a las 03:21:25 hrs., monto 4780.', '18/04 03:21'],
  ['CARNES PREMIUM CHILE SPA', null],
  ['Mtr - buin', null],
  ['Transferencia de bravo figue', null],
  ['MERCADOPAGO*PAPAJOHNS', null],
  ['0220938115 TRANSF. AGUSTIN AREVALO RODRIGUEZ', null],
  ['', null],
  [null, null],
];

let pass = 0, fail = 0;
for (const [raw, expected] of cases) {
  const result = extract(raw);
  const got = result ? fmtChile(result) : null;
  const ok = got === expected;
  console.log(`${ok ? 'OK' : 'FAIL'}  expected=${expected ?? 'null'}  got=${got ?? 'null'}  raw="${(raw ?? '').slice(0,55)}"`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass+fail} OK`);
process.exit(fail > 0 ? 1 : 0);
