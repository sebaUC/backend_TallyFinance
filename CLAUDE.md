# CLAUDE.md — TallyFinance

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TallyFinance is a **personal finance assistant** that operates through Telegram and WhatsApp. Users interact with an AI character called **Gus** — a personality-driven chatbot that registers transactions, checks budgets, tracks goals, and provides financial guidance.

The system uses **Gemini function calling** for single-pass AI orchestration:
- **Backend (NestJS)** handles everything: webhooks, database operations, AI calls via Gemini, tool execution, auth, admin
- **Frontend (React/Vite)** provides web dashboard, onboarding, account linking, and admin tools

**Core Principle:** *"One Gemini call per user turn — the model decides what to do and generates the response with personality."*

## Architecture

```
User Message → Channel Adapter → Backend (NestJS) → Gemini (function calling) → Tool Handlers → Response
```

Gemini receives the full conversation history, system prompt (with Gus personality + user context), and 9 function declarations. It decides which functions to call, the backend executes them and returns results, then Gemini generates the final personalized response. This all happens in a single chat turn with an automatic function-calling loop (max 10 iterations).

### Services

| Service | Port | Technology | Hosting | Purpose |
|---------|------|------------|---------|---------|
| Backend | 3000 | NestJS 11 / TypeScript 5.7 | Render | Webhooks, DB operations, Gemini AI, tool execution, auth, admin |
| Frontend | 5173 | React 19 / Vite 7 | Vercel | Web dashboard, onboarding, account linking |
| Database | — | Supabase (PostgreSQL) | Supabase | Persistent storage + auth |
| Cache | 6379 | Redis (Upstash / ioredis) | Upstash | Caching, rate limiting, state, locks |

### V3 Bot Pipeline

```
1. Handle /start command (Telegram deep links) or /reset (clear conversation)
2. Lookup linked user → build link reply if not found
3. DEDUP: check msg:{msgId} → done/processing/new
4. CONCURRENCY LOCK: acquire lock:{userId} (5s TTL)
5. Check daily token limit (2M tokens/day per user)
6. Load user context (personality, categories, budgets, accounts)
7. Build system prompt from template (tone, mood, displayName, categories, budgets, accounts)
8. Load conversation history from Redis (Gemini Content[] format)
9. Call Gemini with system prompt + history + user message + function declarations
10. Gemini function-calling loop: model calls functions → backend executes → returns results → repeat
11. Save conversation history to Redis (FIFO trim to 50 entries)
12. Track token usage (daily + monthly counters)
13. Post-action: record transaction metrics + invalidate context cache on mutations
14. Log message to bot_message_log (fire-and-forget)
15. Build BotReply[] (confirmation cards + AI comment)
16. Release lock, set dedup to "done"
```

### Tool System (9 Functions)

| Function | DB Tables | Purpose |
|----------|-----------|---------|
| `register_expense` | categories, payment_method, transactions | Record expense with auto-category creation + reactive context |
| `register_income` | payment_method, transactions | Record income (salary, freelance, sales) |
| `query_transactions` | transactions, categories | List, sum, or count transactions with flexible filters |
| `edit_transaction` | transactions, categories | Edit any field of an existing transaction (by ID or hints) |
| `delete_transaction` | transactions | Delete a transaction (by ID or hints) |
| `manage_category` | categories | List, create, rename, delete, update icon/budget for categories |
| `get_balance` | payment_method, transactions, spending_expectations | Balance, spending, income, budget status with optional breakdown |
| `set_balance` | payment_method | Update account balance directly |
| `get_app_info` | None (static knowledge) | App info, help, FAQ, capabilities |

Functions are **pure async functions** with signature `(supabase, userId, args) => result`. They live in `src/bot/v3/functions/` and are routed via a switch in `function-router.ts`. Gemini chooses which to call and can call multiple in parallel per turn.

## Repository Structure

```
TallyFinance/
├── CLAUDE.md                                    # This file (root project guidance)
├── docs/
│   ├── TALLYFINANCE_SYSTEM.md                   # Complete system reference (v2.2, 1100+ lines)
│   ├── TALLYFINANCE_ENDPOINTS.md                # Consolidated endpoint testing guide
│   ├── LANDING_PAGE_CONTENT.md                  # Landing page content
│   └── pruebas-handlers/                        # Tool handler test scripts
│
├── backend/                                     # NestJS backend
│   ├── CLAUDE.md                                # Backend-specific guidance
│   ├── src/
│   │   └── bot/
│   │       ├── bot.controller.ts                # Webhook endpoints + rate limiting
│   │       ├── bot.module.ts                    # All bot providers + adapters
│   │       ├── contracts.ts                     # DomainMessage type definition
│   │       ├── adapters/                        # Telegram + WhatsApp adapters
│   │       ├── delegates/                       # Channel linking service
│   │       ├── actions/                         # BotReply, action-block types
│   │       ├── services/                        # Shared services (context, metrics, response-builder, message-log)
│   │       └── v3/                              # V3 Gemini function calling (active)
│   │           ├── bot-v3.service.ts            # Main orchestration — dedup, lock, Gemini call, post-action
│   │           ├── gemini.client.ts             # Gemini SDK wrapper with function-calling loop
│   │           ├── conversation-v3.service.ts   # Redis-backed conversation history (Content[])
│   │           ├── function-declarations.ts     # 9 Gemini function declarations (Tool[])
│   │           ├── function-router.ts           # Routes function calls to handlers
│   │           ├── prompts/
│   │           │   └── gus_system.txt           # Gus system prompt template
│   │           └── functions/                   # Pure function handlers
│   │               ├── register-expense.fn.ts
│   │               ├── register-income.fn.ts
│   │               ├── query-transactions.fn.ts
│   │               ├── edit-transaction.fn.ts
│   │               ├── delete-transaction.fn.ts
│   │               ├── manage-category.fn.ts
│   │               ├── get-balance.fn.ts
│   │               ├── set-balance.fn.ts
│   │               ├── get-app-info.fn.ts
│   │               ├── emoji-mapper.ts
│   │               └── shared/                  # Shared utilities (chile-time, date-range, resolve-transaction)
│   └── docs/                                    # Endpoint & testing guides
│
├── frontend_TallyFinance/                       # React frontend (65 files, ~8,500 lines)
│   ├── CLAUDE.md                                # Frontend-specific guidance (649 lines)
│   └── src/                                     # Source code
│
├── docker-compose.yml                           # Full stack: redis, backend, ngrok
├── render.yaml                                  # Render deployment config
└── Dockerfile.combined                          # Combined deployment option
```

## Build and Development Commands

### Backend (NestJS)
```bash
cd backend
npm install
npm run start:dev      # Watch mode
npm run build          # Compile TypeScript (nest build)
npm run start:prod     # Production (node dist/main.js)
npm run lint           # ESLint with auto-fix
npm run test           # Jest unit tests
npm run test:watch     # Watch mode
npm run test:e2e       # End-to-end tests
```

### Frontend (React/Vite)
```bash
cd frontend_TallyFinance
npm install
npm run dev            # Dev server on port 5173 (strictPort)
npm run build          # Production build (vite build)
npm run lint           # ESLint
```

### Docker (Full Stack)
```bash
docker-compose up --build
# Services: redis:6379, backend:3000, ngrok:4040
```

### Testing Endpoints
```bash
# Health check
curl http://localhost:3000/

# Test bot (simulates message — no channel adapter needed)
curl -X POST http://localhost:3000/bot/test \
  -H "Content-Type: application/json" \
  -d '{"message":"gasté 15 lucas en comida","userId":"USER_UUID"}'

# Test V3 with conversation reset
curl -X POST http://localhost:3000/bot/test-v3 \
  -H "Content-Type: application/json" \
  -d '{"userId":"USER_UUID","reset":true}'
```

## All Endpoints (30+)

### Auth (`/auth`) — 13 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/signup` | No | Email/password registration, sets HTTP-only cookies |
| POST | `/auth/signin` | No | Email/password login, sets cookies |
| POST | `/auth/provider` | No | OAuth flow (Google only — `@IsIn(['google'])`) |
| GET | `/auth/callback` | No | OAuth callback handler |
| POST | `/auth/refresh` | Cookie | Refresh access token from refresh_token cookie |
| POST | `/auth/logout` | No | Clear auth cookies |
| GET | `/auth/me` | JWT | Get profile (with onboarding + link status) |
| GET | `/auth/sessions` | JWT | List user sessions |
| GET | `/auth/link-status` | JWT | Channel linking status |
| POST | `/auth/create-link-token` | JWT | Generate link code for web-initiated flow |
| POST | `/auth/link-channel` | JWT | Link channel via code (with force option) |
| POST | `/auth/unlink-channel` | JWT | Remove channel link |
| POST | `/auth/onboarding` | JWT | Submit onboarding (7 sync steps) |

### Connect (`/connect`) — 2 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/connect/:code` | Cookie | Channel linking redirect flow |
| GET | `/connect/:code/api` | JWT | Channel linking JSON API |

### Bot (webhooks) — 4 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/telegram/webhook` | No | Telegram Bot API webhook |
| POST | `/whatsapp/webhook` | No | WhatsApp Cloud API webhook |
| POST | `/bot/test` | No | Test endpoint: `{ message, userId, channel?, verbose? }` |
| POST | `/bot/test-v3` | No | V3 test endpoint with conversation reset support |

### Users (`/api/users`) — 3 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users/me` | JWT | User profile |
| GET | `/api/users/context` | JWT | Full user context |
| GET | `/api/users/transactions?limit=` | JWT | Transactions (default 50, max 200) |

### Admin (`/admin`) — 9 endpoints (AdminGuard: hardcoded UUID whitelist)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/check` | Verify admin access |
| GET | `/admin/dashboard?hours=` | Dashboard stats |
| GET | `/admin/messages?...` | Paginated messages (userId, channel, from, to, hasError) |
| GET | `/admin/messages/:id` | Message detail with debug info |
| GET | `/admin/users/:userId/chat?limit=` | User chat history |
| GET | `/admin/users/:userId/profile` | User profile with personality |
| GET | `/admin/errors?limit=&offset=` | Error messages |
| GET | `/admin/users` | Active users list |
| GET | `/admin/usage?month=` | API usage analytics |

### Frontend API Client Namespaces
| Namespace | Methods | Usage |
|-----------|---------|-------|
| `authApi` | signup, signin, me, refresh, logout, linkChannel, createLinkToken, submitOnboarding, linkStatus, linkCodeStatus | Auth flows |
| `userApi` | getTransactions | Dashboard data |
| `linkApi` | initiate, complete, status, unlink | New linking flow (`/api/link/*`) |
| `adminApi` | check, getDashboard, getMessages, getMessage, getUserChat, getUserProfile, getErrors, getActiveUsers, getUsage | Admin panel |

## Frontend Routes

| Path | Component | Auth | Purpose |
|------|-----------|------|---------|
| `/` | Home (MainLayout) | No | Landing page (9 sections, redirects auth users) |
| `/auth` | Auth | No | Login/register with Google OAuth |
| `/onboarding` | Onboarding | JWT | 10-step wizard |
| `/app` | Dashboard | JWT | Main app: linked → TransactionLog, unlinked → connect prompt |
| `/connect/:code` | ChannelLinkCapture | No | Auto-link channel, redirects to auth if needed |
| `/admin` | AdminLayout | Admin | Admin dashboard (nested routes) |
| `/admin/checklist` | AdminChecklist | Admin | Progress tracker |
| `/admin/docs` | AdminDocs | Admin | HTML docs viewer |
| `/admin/usage` | AdminUsage | Admin | Usage charts |
| `/admin/messages` | AdminMessages | Admin | Message browser |
| `/admin/messages/:id` | AdminMessageDetail | Admin | Message detail |

## Gus — AI Character

| Trait | Value |
|-------|-------|
| Name | Gus (full name "Gustavo" — Breaking Bad easter egg, used rarely) |
| Role | Personal finance assistant, "hired" by user |
| Personality | Serious but kind, professional, direct, slightly sarcastic |
| Origin | Chilean, default currency CLP |
| Company | TallyFinance SPA |
| Never says | That he's a bot/AI/program |
| Speaking style | Chilean Spanish when user does, understands "lucas" = x1000 CLP |

### Personality System

| Setting | Source | Values |
|---------|--------|--------|
| Tone | `personality_snapshot.tone` | neutral, friendly, serious, motivational, strict, toxic |
| Mood | `personality_snapshot.mood` | frustrated → tired → normal → hopeful → happy → proud |

Tone and mood are injected into the Gus system prompt (`gus_system.txt`) via template variables `{tone}` and `{mood}`. Gemini receives the full personality definition and generates responses in character.

### 3-Circle Scope

| Circle | Topics | AI Action |
|--------|--------|-----------|
| 1 — Core | TallyFinance, Gus, transactions, budgets, goals, categories, balance | Always execute function |
| 2 — Related | Personal finance, Chilean economy, savings tips | Respond with judgment |
| 3 — Out of domain | Science, history, politics, programming | Redirect politely (with humor in Gus's tone) |

## Database (Supabase)

### Core Tables

| Table | Purpose | Accessed By |
|-------|---------|-------------|
| `users` | User profiles | Backend (auth, onboarding, context) |
| `user_prefs` | Preferences (notifications, unified_balance) | Backend (context, onboarding) |
| `personality_snapshot` | Bot personality per user (tone, mood) | Backend (context, onboarding) |
| `channel_accounts` | Platform links (user ↔ Telegram/WhatsApp) | Backend (bot, auth, linking) |
| `channel_link_codes` | Temp link codes (10-min TTL) | Backend (linking flow) |
| `transactions` | Financial records | Backend (tools, user API) |
| `categories` | Expense categories (user-specific) | Backend (tools, onboarding) |
| `payment_method` | Payment accounts | Backend (tools, onboarding) |
| `goals` | Savings goals with progress | Backend (tools, onboarding) |
| `spending_expectations` | Budget config (daily/weekly/monthly) | Backend (tools, onboarding) |
| `bot_message_log` | Admin message log | Backend (admin, message-log service) |
| `user_emotional_log` | Emotion tracking (**schema exists, not accessed by code**) | None |

### Key Enums

| Enum | Values |
|------|--------|
| `bot_tone_enum` | neutral, friendly, serious, motivational, strict |
| `bot_mood_enum` | normal, happy, disappointed, tired, hopeful, frustrated, proud |
| `channel_t` | telegram, whatsapp, web |
| `goal_status_enum` | in_progress, completed, canceled |
| `tx_source_t` | manual, chat_intent, import, bank_api, ai_extraction |
| `payment_type_t` | credito, debito |
| `emotion_t` | neutral, feliz, triste, ansioso, enojado, estresado |

## Redis Architecture

| Key Pattern | TTL | Purpose | Service |
|-------------|-----|---------|---------|
| `ctx:{userId}` | 60s | User context cache (6 parallel DB queries) | UserContextService |
| `rl:{externalId}` | 60s | Rate limiting (30 msgs/min) | AsyncRateLimiter |
| `lock:{userId}` | 5s | Concurrency lock | BotV3Service |
| `msg:{msgId}` | 120s→24h | Two-phase message dedup | BotV3Service |
| `conv:v3:{userId}` | 4h | Gemini conversation history (Content[] format, FIFO 50 entries) | ConversationV3Service |
| `conv:{userId}:metrics` | 30d | Streak days, week tx count | MetricsService |
| `tokens:daily:{userId}` | 24h | Daily token usage counter | BotV3Service |
| `tokens:monthly:{userId}` | 30d | Monthly token usage counter | BotV3Service |

**Fallback:** Single instance → in-memory Map with warning. Multi instance → fail hard (503).

## Resilience Patterns

| Pattern | Location | Config |
|---------|----------|--------|
| **Rate Limiting** | `bot.controller.ts` | 30 msgs/60s per user (ZSET + sliding window) |
| **Message Dedup** | `bot-v3.service.ts` | Two-phase: "processing" (120s) → "done" (24h) |
| **User Lock** | `bot-v3.service.ts` | `lock:{userId}` 5s TTL, explicit release |
| **Context Cache** | `user-context.service.ts` | Redis 60s TTL, 6 parallel DB queries on miss |
| **Token Limit** | `bot-v3.service.ts` | 2M tokens/day per user, checked before Gemini call |
| **Function Loop Cap** | `gemini.client.ts` | Max 10 function-calling iterations per turn |

## Authentication

| Method | Details |
|--------|---------|
| Email/password | Signup with argon2 hashing, signin with JWT cookies |
| Google OAuth | Only supported provider (`@IsIn(['google'])`) |
| JWT Cookies | `access_token` (1h, HttpOnly, Secure, SameSite=Lax) + `refresh_token` (7d) |
| Frontend token | Module-level `currentAccessToken` in apiClient.js, auto 401 → refresh retry |

## Channel Linking Flow

**Bot-initiated:** User messages bot → bot creates link code (10-min TTL) → sends link URL → user clicks → web auto-links or redirects to login first.

**Web-initiated:** User generates code on dashboard → sends `/start CODE` to Telegram bot → bot validates → links account.

**Linking state machine** (frontend): `IDLE → INITIATING → AWAITING_BOT → POLLING → SUCCESS/ERROR/TIMEOUT/EXPIRED/CANCELLED` with exponential backoff polling (2s initial, 8s max, 1.5x factor, 100 max attempts).

## Onboarding

**Backend (7 sync steps in single POST):** users → user_prefs → personality_snapshot → categories → payment_methods → spending_expectations → goals

**Frontend (10-step wizard):** Intro → Tone → Intensity → Preferences → Accounts → Categories (710 lines, 3 layouts) → Balance → Spending → Goals → Outro

## Frontend Design System

| Property | Value |
|----------|-------|
| Font | Goldplay (CDN loaded, weights 400-800) |
| Primary Color | `#0364c6` (primaryDark: `#023a7e`) |
| Breakpoints | Mobile <640px, Tablet 640-1279px, Desktop 1280px+ (3-tier) |
| Border Radius | `rounded-2xl` (cards), `rounded-xl` (inputs), `rounded-full` (pills) |
| Shadows | Custom: `card` (0 4px 15px rgba), `glow` (0 0 25px primaryDark) |
| Backgrounds | Gradient blurs via `bg-gradient-to-br` + `backdrop-blur-xl` |

## Environment Variables

### Backend (.env)
```bash
# Server
PORT=3000
NODE_ENV=development
APP_BASE_URL=http://localhost:3000

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Gemini
GEMINI_API_KEY=AIza...

# Redis
REDIS_URL=redis://localhost:6379

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_SECRET=secret

# WhatsApp
WHATSAPP_TOKEN=EAAx...
WHATSAPP_PHONE_NUMBER_ID=123456789

# Frontend
CORS_ORIGINS=http://localhost:5173
LINK_ACCOUNT_URL=http://localhost:5173/connect/

# Feature Flags
MULTI_INSTANCE=false        # true = fail hard when Redis unavailable
```

### Frontend (.env)
```bash
VITE_API_URL=http://localhost:3000   # Backend URL
```

## Adding a New Function (V3)

1. **Create the handler** in `src/bot/v3/functions/my-function.fn.ts`:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';

export async function myFunction(
  supabase: SupabaseClient,
  userId: string,
  args: { /* typed args */ },
): Promise<Record<string, any>> {
  // Execute DB operations
  return { ok: true, data: { /* result */ } };
}
```

2. **Add the declaration** in `function-declarations.ts` — add to the `functionDeclarations` array:

```typescript
{
  name: 'my_function',
  description: 'Description in Spanish for Gemini',
  parameters: {
    type: 'object' as any,
    properties: {
      // Parameter definitions with S() helper
    },
    required: ['required_param'],
  },
},
```

3. **Register in the router** in `function-router.ts` — add a case to the switch:

```typescript
case 'my_function':
  return myFunction(supabase, userId, args as any);
```

4. **Add confirmation card** (if applicable) in `bot-v3.service.ts` `buildCardForFunction()` and `response-builder.service.ts` — build the visual card the user sees.

5. **Add to MUTATION_FNS** (if applicable) in `bot-v3.service.ts` — if the function mutates data, add it to trigger cache invalidation.

## Error Codes

### Backend (internal)
| Code | When |
|------|------|
| `INVALID_AMOUNT` | Amount <= 0 or >= 100,000,000 |
| `NOT_FOUND` | Transaction/category not found |
| `AMBIGUOUS` | Multiple transactions match hints |
| `UNKNOWN_FUNCTION` | Gemini called a function not in the router |
| `DB_ERROR` | Supabase query failed |

### User-Facing Messages (Spanish)
| Error | Message |
|-------|---------|
| Gemini failure | "Tuve un problema procesando tu mensaje. Intenta de nuevo." |
| Token limit | "Has alcanzado tu limite diario de mensajes. Vuelve manana o mejora tu plan." |
| Lock busy | "Dame un momento, estoy procesando tu mensaje anterior." |
| Dedup | "Procesando tu mensaje anterior..." |
| Rate limit | "Demasiados mensajes. Espera un momento antes de enviar mas." |

## Detailed Documentation

| Document | Lines | Purpose |
|----------|-------|---------|
| `docs/TALLYFINANCE_SYSTEM.md` | 1100+ | Complete system reference (architecture, flows, schemas, gaps, roadmap) |
| `docs/TALLYFINANCE_ENDPOINTS.md` | — | Consolidated endpoint testing guide |
| `backend/CLAUDE.md` | — | Backend: file structure, V3 pipeline, function handlers, Redis, auth, admin |
| `frontend_TallyFinance/CLAUDE.md` | 649 | Frontend: file structure, routes, hooks, API client, design system, user flows |
