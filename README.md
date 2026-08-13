# Rurbit Pay

A production-oriented MVP for institutions that batch-pay validated Rurbit Lightning addresses with funds from their own Blink wallet.

## What is included

- React 18 + TypeScript dashboard with responsive batch review, progress, reporting, and history
- Node.js + Express API with PostgreSQL/Prisma persistence
- Live Blink GraphQL integration—there is no simulated payment mode
- Blink permission verification through `authorization { scopes }` plus wallet lookup
- AES-256-GCM encryption with a random 96-bit IV, authentication tag, and institution/version-bound AAD
- Server-side draft batches, so payment recipients are never trusted from a second client submission
- Sequential payment runner with a configurable 2-second delay and per-row failure isolation
- Opaque, hashed server sessions in `HttpOnly`, `SameSite=Strict` cookies
- Local key purge after every attempted batch, including failed batches
- Interrupted-batch recovery that fails closed rather than automatically risking duplicate payments
- Audit events, recipient outcomes, security headers, origin checks, request limits, and redacted logs

## Important Blink corrections

The original brief contained three unsafe or inaccurate assumptions. This implementation corrects them:

1. **Permission checks do not send a test payment.** Blink exposes `authorization { scopes }`; onboarding requires both `READ` and `WRITE`. An intentionally malformed one-sat mutation is not a reliable scope test and could become risky if the API behavior changes.
2. **A Lightning address is not a wallet ID.** `intraLedgerPaymentSend.recipientWalletId` requires a Blink `WalletId`, not `u123@rurbit.com`. The default route therefore uses Blink's official `lnAddressPaymentSend` mutation. Optional intra-ledger mode first resolves the username with `accountDefaultWallet` and fails clearly if no Blink wallet can be resolved.
3. **Deleting our copy is not remote revocation.** After the batch, the ciphertext, IV, and auth tag are deleted from this database and the in-memory buffer is overwritten. The UI explicitly asks the institution to revoke the key in Blink. It never claims that Blink-side revocation was confirmed.

Blink references:

- Authentication: <https://dev.blink.sv/api/auth>
- Send over Lightning: <https://dev.blink.sv/api/btc-ln-send>
- Public GraphQL reference: <https://dev.blink.sv/public-api-reference.html>

## Architecture

```text
Browser (never receives key)
  │  TLS + HttpOnly session cookie
  ▼
Express API
  ├─ registration → Blink authorization + wallet query
  ├─ CSV validation → immutable server-side draft
  ├─ batch claim → sequential payment worker
  └─ report/history polling
  │
  ├─ Blink GraphQL (X-API-KEY only in server request memory)
  └─ PostgreSQL
       ├─ encrypted key: AES-256-GCM ciphertext + IV + auth tag
       ├─ batches and recipient outcomes
       ├─ hashed sessions
       └─ audit events
```

### Payment lifecycle

1. Institution submits its ID and a short-lived Blink key.
2. API asks Blink for the key scopes and account wallets; it requires `READ` + `WRITE` and selects the configured BTC or USD wallet.
3. Only after verification, the key is encrypted and stored.
4. CSV is parsed on the server and persisted as a `DRAFT`; the browser receives a review copy.
5. The institution confirms an irreversible payment action. A database transition atomically claims the draft.
6. Recipients are paid sequentially. A row failure is recorded without aborting later rows.
7. The local encrypted key fields are set to `NULL`, status becomes `PURGED`, and a local-purge audit event is written.
8. The institution revokes the API key in the Blink dashboard and creates a fresh one before its next batch.

## Project layout

```text
backend/
  src/
    auth.ts            # Opaque session creation and authorization
    batch-runner.ts    # Sequential execution, cleanup, crash recovery
    blink.ts           # Live Blink GraphQL adapter
    config.ts          # Validated environment configuration
    csv-parser.ts      # Strict CSV and Rurbit address validation
    encryption.ts      # AES-256-GCM utilities
    routes.ts          # REST endpoints
    server.ts          # Express entry point and security middleware
  tests/
frontend/
  src/
    components/        # Login, upload, dashboard, results
    lib/api.ts         # Same-origin API client
    hooks.ts           # Session and payment state
prisma/
  schema.prisma
  migrations/
compose.yaml
```

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 16 (the included Compose file is convenient for local development)
- A Blink custodial account with a short-lived API key containing `Read` and `Write` scopes

> Blink's non-custodial Spark accounts do not expose GraphQL API keys or wallet IDs and cannot be used for this sender workflow.

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL
# Docker Compose v2:
docker compose up -d postgres

# 3. Create local configuration
cp .env.example .env

# 4. Generate a real 32-byte encryption secret
openssl rand -base64 32
# Paste the output into ENCRYPTION_SECRET in .env

# 5. Create database tables and Prisma client
npm run db:generate
npm run db:deploy

# 6. Start the API and frontend
npm run dev
```

Open <http://localhost:5173>. Vite proxies same-origin `/api` calls to port 4000.

### Staging before mainnet

For initial testing, set:

```dotenv
BLINK_GRAPHQL_URL="https://api.staging.blink.sv/graphql"
```

Use staging/signet funds and a staging key. Only switch to `https://api.blink.sv/graphql` after confirming the entire workflow with two or three recipients.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `ENCRYPTION_SECRET` | yes | — | Exactly 32 random bytes, base64 or 64-character hex |
| `NODE_ENV` | no | `development` | Enables production cookie/origin/static behavior |
| `PORT` | no | `4000` | Express port |
| `FRONTEND_ORIGIN` | yes in production | `http://localhost:5173` | Exact trusted origin for state-changing requests |
| `BLINK_GRAPHQL_URL` | no | mainnet | Blink GraphQL endpoint |
| `DEFAULT_WALLET_CURRENCY` | no | `BTC` | Single sender wallet selected at verification (`BTC` or `USD`) |
| `PAYMENT_DELAY_MS` | no | `2000` | Delay between recipients |
| `SESSION_TTL_HOURS` | no | `8` | Institution session lifetime |
| `MAX_BATCH_RECIPIENTS` | no | `500` | Server-side batch cap |

Do not commit `.env`.

## Canonical CSV format

```csv
address,amount,memo
u66474248@rurbit.com,1000,January payment
u77483920@rurbit.com,500,January payment
u88392048@rurbit.com,2000,January payment
```

Validation rules:

- Header order must be exactly `address,amount,memo`.
- Address must match `u<digits>@rurbit.com`, `.io`, or `.co`.
- Amount is a positive whole number of satoshis, maximum 100,000,000 per row.
- Memo is at most 200 characters. It is retained in reports; Blink's Lightning-address mutation does not transmit a memo field.
- Duplicate addresses in one batch are rejected to reduce accidental double payment.
- Maximum file size is 1 MB and the recipient count defaults to 500.

The conflicting `rurbit_address,amount_memo,sats` header shown in the original brief is not accepted because its names do not match its row ordering.

## API

| Method | Endpoint | Auth | Description |
|---|---|---:|---|
| `POST` | `/api/institutions/register` | no | Verify key, create/update institution, issue session |
| `GET` | `/api/session` | cookie | Current institution and local key status |
| `DELETE` | `/api/session` | cookie | Sign out and remove server session |
| `GET` | `/api/institutions/:id` | cookie | Institution summary |
| `POST` | `/api/institutions/:id/upload-csv` | cookie | Validate CSV and create immutable draft |
| `POST` | `/api/institutions/:id/pay-batch` | cookie | Atomically claim a draft and return `202` |
| `GET` | `/api/institutions/:id/batches` | cookie | Latest 20 batches |
| `GET` | `/api/institutions/:id/batches/:batchId` | cookie | Batch progress and per-recipient report |
| `GET` | `/api/healthz` | no | Process health |

`pay-batch` accepts a `batchId` and `acknowledgeIrreversible: true`; it does **not** accept a replacement recipient array. That design prevents browser tampering between review and execution.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Current automated coverage includes AES-GCM round trips/tamper rejection/AAD binding and CSV success/failure cases. A real Blink payment was intentionally not executed without institution-owned credentials and explicit transaction confirmation.

## Production deployment notes

- Terminate TLS at a trusted reverse proxy and set `NODE_ENV=production`.
- Set `FRONTEND_ORIGIN` to the exact public HTTPS origin.
- Run `npm run build`, `npm run db:deploy`, then `npm start`. Express serves the built React application in production.
- Keep one API replica for this MVP's in-process payment runner. For horizontal scaling, move execution to a durable queue/worker with a lease and reconciliation process.
- Back up payment/audit records, but do not back up or retain purged key fields.
- Prefer a KMS/HSM-backed envelope key over a long-lived environment secret at larger scale.
- Add operator alerting for `OUTCOME_UNKNOWN`, `SERVER_INTERRUPTED`, or local-purge persistence failures. Never automatically retry an ambiguous Lightning send.
- Consider retention limits and a data-processing agreement for institution and recipient records.

See [SECURITY.md](SECURITY.md) for the threat model and known limitations.
