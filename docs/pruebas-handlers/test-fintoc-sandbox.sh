#!/bin/bash
# ═══════════════════════════════════════════════════════
#  FINTOC SANDBOX — Test Suite
# ═══════════════════════════════════════════════════════

ENV_FILE="backend/.env"
if [ -z "$FINTOC_SECRET_KEY" ] && [ -f "$ENV_FILE" ]; then
  export FINTOC_SECRET_KEY=$(grep '^FINTOC_SECRET_KEY=' "$ENV_FILE" | cut -d'=' -f2-)
  export FINTOC_LINK_TOKEN=$(grep '^FINTOC_LINK_TOKEN=' "$ENV_FILE" | cut -d'=' -f2-)
fi

BASE="https://api.fintoc.com/v1"
TMP="/tmp/fintoc_test"
mkdir -p "$TMP"

if [ -z "$FINTOC_SECRET_KEY" ] || [ -z "$FINTOC_LINK_TOKEN" ]; then
  echo ""; echo "  ❌  Faltan FINTOC_SECRET_KEY y/o FINTOC_LINK_TOKEN"; echo ""; exit 1
fi

clear
echo ""
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║       FINTOC SANDBOX — Test Suite             ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo ""
echo "  Key:   ${FINTOC_SECRET_KEY:0:20}..."
echo "  Token: ${FINTOC_LINK_TOKEN:0:20}..."
echo ""

# ══════════════════════════════════════════════════════
#  TEST 1 — CUENTAS
# ══════════════════════════════════════════════════════
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  TEST 1 — Cuentas conectadas                │"
echo "  │  GET /v1/accounts?link_token=...            │"
echo "  │  → Lista de cuentas con saldos              │"
echo "  └─────────────────────────────────────────────┘"
echo ""

curl -s "$BASE/accounts?link_token=$FINTOC_LINK_TOKEN" \
  -H "Authorization: $FINTOC_SECRET_KEY" > "$TMP/accounts.json"

python3 -c "
import json
with open('$TMP/accounts.json') as f:
    data = json.load(f)
accs = data if isinstance(data, list) else data.get('data', [])
if not accs:
    print('     (sin cuentas)')
else:
    for a in accs:
        bal = a.get('balance', {}) or {}
        avail = bal.get('available', 0)
        curr = bal.get('current', 0)
        c = a.get('currency', '?')
        print(f'     ID         {a.get(\"id\", \"?\")}')
        print(f'     Tipo       {a.get(\"type\", \"?\")}')
        print(f'     Nombre     {a.get(\"name\", a.get(\"official_name\", \"?\"))}')
        print(f'     Titular    {a.get(\"holder_name\", \"?\")}')
        print(f'     Moneda     {c}')
        print(f'     Disponible {avail:>14,} {c}')
        print(f'     Contable   {curr:>14,} {c}')
        print()
"

ACCOUNT_ID=$(python3 -c "
import json
with open('$TMP/accounts.json') as f:
    data = json.load(f)
accs = data if isinstance(data, list) else data.get('data', [])
if accs: print(accs[0]['id'])
")

if [ -z "$ACCOUNT_ID" ]; then
  echo "  ❌  No se encontraron cuentas."; exit 1
fi
echo "  ✅  Account ID: $ACCOUNT_ID"
echo ""

# ══════════════════════════════════════════════════════
#  TEST 2 — MOVIMIENTOS RAW
# ══════════════════════════════════════════════════════
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  TEST 2 — Movimientos recientes (raw)       │"
echo "  │  GET /v1/accounts/{id}/movements?limit=50   │"
echo "  │  → Cada movimiento con todos sus campos     │"
echo "  └─────────────────────────────────────────────┘"
echo ""

curl -s "$BASE/accounts/$ACCOUNT_ID/movements?link_token=$FINTOC_LINK_TOKEN&limit=50" \
  -H "Authorization: $FINTOC_SECRET_KEY" > "$TMP/movements.json"

python3 -c "
import json
with open('$TMP/movements.json') as f:
    data = json.load(f)
movs = data if isinstance(data, list) else data.get('data', data.get('results', []))
print(f'     Total recibidos: {len(movs)}')
print()

# JSON completo de un movimiento tipo 'other'
other = next((m for m in movs if m.get('type') == 'other'), None)
if other:
    print('     Ejemplo JSON completo (type: other):')
    print()
    for line in json.dumps(other, indent=4, ensure_ascii=False).split(chr(10)):
        print(f'     {line}')
    print()
else:
    print('     (no hay movimientos tipo other para mostrar JSON)')
    print()
"
echo ""

# ══════════════════════════════════════════════════════
#  TEST 2b — LISTADO COMPLETO DE MOVIMIENTOS
# ══════════════════════════════════════════════════════
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  TEST 2b — Listado completo                 │"
echo "  │  → Todos los movimientos en una tabla        │"
echo "  └─────────────────────────────────────────────┘"
echo ""

python3 -c "
import json
with open('$TMP/movements.json') as f:
    data = json.load(f)
movs = data if isinstance(data, list) else data.get('data', data.get('results', []))

print(f'     {\"#\":>3s}  {\"FECHA\":10s}  {\"TIPO\":10s}  {\"MONTO\":>14s}  {\"STATUS\":10s}  DESCRIPTION')
print(f'     {\"─\"*3}  {\"─\"*10}  {\"─\"*10}  {\"─\"*14}  {\"─\"*10}  {\"─\"*30}')

for i, m in enumerate(movs, 1):
    amt = m.get('amount', 0)
    sign = '+' if amt >= 0 else ' '
    date = (m.get('post_date') or '?')[:10]
    t = m.get('type', '?')
    status = m.get('status', '?')
    desc = m.get('description', '(sin desc)')
    if len(desc) > 30:
        desc = desc[:27] + '...'
    print(f'     {i:3d}  {date:10s}  {t:10s}  {sign}{amt:>13,}  {status:10s}  {desc}')
"
echo ""

# ══════════════════════════════════════════════════════
#  TEST 3 — DISTRIBUCION DE TIPOS
# ══════════════════════════════════════════════════════
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  TEST 3 — Distribucion de tipos             │"
echo "  │  CLAVE: % de transfer vs other vs check     │"
echo "  │  • transfer = TEF con metadata              │"
echo "  │  • other = compras, PAC, suscripciones      │"
echo "  │  • check = cheques                          │"
echo "  └─────────────────────────────────────────────┘"
echo ""

python3 -c "
import json
with open('$TMP/movements.json') as f:
    data = json.load(f)
movs = data if isinstance(data, list) else data.get('data', data.get('results', []))
total = len(movs)
if total == 0:
    print('     Sin movimientos.')
    exit()
types = {}
for m in movs:
    t = m.get('type', 'unknown')
    types[t] = types.get(t, 0) + 1
max_count = max(types.values())
for t, count in sorted(types.items(), key=lambda x: -x[1]):
    pct = count / total * 100
    bar_len = int(count / max_count * 30)
    bar = '▓' * bar_len + '░' * (30 - bar_len)
    print(f'     {t:12s}  {bar}  {count:3d}  ({pct:.0f}%)')
print()
print(f'     Total: {total} movimientos')
"
echo ""

# ══════════════════════════════════════════════════════
#  TEST 4 — MOVIMIENTOS "OTHER" (COMPRAS)
# ══════════════════════════════════════════════════════
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  TEST 4 — Compras y cargos (type: other)    │"
echo "  │  → Compras debito, PAC, suscripciones       │"
echo "  │  → DESCRIPTION = lo que parseamos con ML    │"
echo "  └─────────────────────────────────────────────┘"
echo ""

python3 -c "
import json
with open('$TMP/movements.json') as f:
    data = json.load(f)
movs = data if isinstance(data, list) else data.get('data', data.get('results', []))
others = [m for m in movs if m.get('type') == 'other']
if not others:
    print('     No hay movimientos tipo \"other\".')
    exit()
print(f'     {len(others)} movimientos encontrados:')
print()
print(f'     {\"FECHA\":12s}  {\"MONTO\":>14s}  DESCRIPTION')
print(f'     {\"─\"*12}  {\"─\"*14}  {\"─\"*36}')
for m in others:
    amt = m.get('amount', 0)
    sign = '+' if amt >= 0 else ' '
    date = (m.get('post_date') or '?')[:10]
    desc = m.get('description', '(sin desc)')
    print(f'     {date:12s}  {sign}{amt:>13,}  {desc}')
"
echo ""

# ══════════════════════════════════════════════════════
#  TEST 5 — TRANSFERENCIAS
# ══════════════════════════════════════════════════════
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  TEST 5 — Transferencias (type: transfer)   │"
echo "  │  → Metadata: nombre, RUT, banco, cuenta     │"
echo "  └─────────────────────────────────────────────┘"
echo ""

python3 -c "
import json
with open('$TMP/movements.json') as f:
    data = json.load(f)
movs = data if isinstance(data, list) else data.get('data', data.get('results', []))
transfers = [m for m in movs if m.get('type') == 'transfer']
if not transfers:
    print('     No hay transferencias.')
    exit()
print(f'     {len(transfers)} transferencias encontradas:')
print()
for m in transfers[:5]:
    amt = m.get('amount', 0)
    sign = '+' if amt >= 0 else ' '
    s = m.get('sender_account') or {}
    r = m.get('recipient_account') or {}
    inst_s = (s.get('institution') or {}).get('name', '?')
    inst_r = (r.get('institution') or {}).get('name', '?')
    print(f'     ┌ {(m.get(\"post_date\") or \"?\")[:10]}  {sign}{amt:>13,} {m.get(\"currency\",\"\")}')
    print(f'     │ Desc:     {m.get(\"description\", \"(vacio)\")}')
    if s.get('holder_name'):
        print(f'     │ Desde:    {s.get(\"holder_name\",\"?\")} · {s.get(\"holder_id\",\"?\")} · {inst_s}')
    if r.get('holder_name'):
        print(f'     │ Hacia:    {r.get(\"holder_name\",\"?\")} · {r.get(\"holder_id\",\"?\")} · {inst_r}')
    if m.get('comment'):
        print(f'     │ Nota:     {m.get(\"comment\")}')
    print(f'     └ Status:   {m.get(\"status\",\"?\")}')
    print()
if len(transfers) > 5:
    print(f'     ... y {len(transfers) - 5} mas')
"
echo ""

# ══════════════════════════════════════════════════════
#  TEST 6 — RESUMEN FINANCIERO 90 DIAS
# ══════════════════════════════════════════════════════
SINCE=$(date -v-90d +%Y-%m-%d 2>/dev/null || date -d "90 days ago" +%Y-%m-%d 2>/dev/null)
UNTIL=$(date +%Y-%m-%d)

echo "  ┌─────────────────────────────────────────────┐"
echo "  │  TEST 6 — Resumen financiero (90 dias)      │"
echo "  │  GET ...?since=$SINCE&until=$UNTIL  │"
echo "  │  → Ingresos, egresos, top descriptions      │"
echo "  └─────────────────────────────────────────────┘"
echo ""

curl -s "$BASE/accounts/$ACCOUNT_ID/movements?link_token=$FINTOC_LINK_TOKEN&since=$SINCE&until=$UNTIL&limit=300" \
  -H "Authorization: $FINTOC_SECRET_KEY" > "$TMP/filtered.json"

python3 -c "
import json
with open('$TMP/filtered.json') as f:
    data = json.load(f)
movs = data if isinstance(data, list) else data.get('data', data.get('results', []))
total = len(movs)
print(f'     Periodo: $SINCE → $UNTIL')
print(f'     Movimientos: {total}')
print()
if total == 0:
    print('     Sin movimientos en este rango.')
    exit()

ingresos = sum(m.get('amount',0) for m in movs if m.get('amount',0) > 0)
egresos = sum(m.get('amount',0) for m in movs if m.get('amount',0) < 0)
neto = ingresos + egresos

print(f'     ╔════════════════════════════════╗')
print(f'     ║  Ingresos    +{ingresos:>14,}  ║')
print(f'     ║  Egresos     {egresos:>15,}  ║')
print(f'     ║  ────────────────────────────  ║')
print(f'     ║  Neto        {neto:>15,}  ║')
print(f'     ╚════════════════════════════════╝')
print()

types = {}
for m in movs:
    t = m.get('type','?')
    types[t] = types.get(t,0) + 1
print('     Por tipo:')
for t, c in sorted(types.items(), key=lambda x: -x[1]):
    print(f'       {t:12s}  {c:3d}')
print()

descs = {}
for m in movs:
    d = m.get('description','')
    if d: descs[d] = descs.get(d,0) + 1
if descs:
    s = sorted(descs.items(), key=lambda x: -x[1])
    print(f'     Descriptions unicas: {len(descs)}')
    print(f'     Top 15:')
    print()
    for d, count in s[:15]:
        print(f'       {count:2d}x  {d}')
    if len(s) > 15:
        print(f'       ... y {len(s)-15} mas')
"
echo ""

# ══════════════════════════════════════════════════════
#  FIN
# ══════════════════════════════════════════════════════
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║              Tests completados ✅             ║"
echo "  ╠═══════════════════════════════════════════════╣"
echo "  ║                                               ║"
echo "  ║  Lo clave:                                    ║"
echo "  ║  • Test 3 → % de 'other' vs 'transfer'       ║"
echo "  ║  • Test 4 → Descriptions de compras           ║"
echo "  ║  • Test 6 → Top descriptions = merchants      ║"
echo "  ║                                               ║"
echo "  ║  NOTA: El sandbox genera data ficticia.       ║"
echo "  ║  Descriptions reales (COMPRA POS LIDER, etc.) ║"
echo "  ║  solo se ven en modo live con cuenta real.    ║"
echo "  ║                                               ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo ""

# Cleanup
rm -rf "$TMP"
