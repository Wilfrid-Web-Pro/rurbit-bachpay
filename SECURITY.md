# Security model

## Assets protected

- Institution Blink API keys with spend permission
- Sender wallet identifiers and balance snapshots
- Recipient addresses, amounts, memos, and payment outcomes
- Institution sessions and batch-control endpoints

## Controls implemented

### API keys

- Keys are accepted only over the backend registration endpoint and are never returned by any API.
- Blink's `authorization` query must report both `READ` and `WRITE` before storage.
- AES-256-GCM uses a fresh 12-byte IV and 16-byte authentication tag for every key version.
- Additional authenticated data binds ciphertext to the institution ID and key version, preventing ciphertext swapping.
- Ciphertext, IV, and authentication tag are stored separately; raw keys are not stored.
- The decrypted key is held in a `Buffer` only for batch execution and overwritten in `finally`.
- After every claimed batch—success, partial failure, or fatal failure—the database key fields are nulled when storage is available.
- Logs redact API key fields, cookies, authorization headers, and encrypted-key columns.

### Authentication and request integrity

- A successful Blink account verification proves access to the existing institution's original `blinkUserId` before key rotation.
- Sessions use 256-bit opaque tokens; only SHA-256 token hashes are stored.
- Verifying or rotating an institution key invalidates all older application sessions before issuing a new one.
- Cookies are `HttpOnly` and `SameSite=Strict`; production cookies are `Secure`.
- Production state-changing requests require the exact configured `Origin`.
- Institution routes verify both the session and path institution ID.
- Registration and general API rate limits are enabled.
- Helmet sets CSP, frame, MIME, referrer, and other browser security headers.

### Payment safety

- CSVs become immutable server-side drafts. The execution endpoint accepts only the draft ID and an irreversible-payment acknowledgement.
- A conditional status update claims the draft once, reducing duplicate starts.
- Only one processing batch per institution is allowed.
- Individual row failures do not abort later rows.
- Only explicit HTTP 429 responses are retried. Network timeouts and 5xx responses are not automatically retried because a payment outcome may be ambiguous.
- A process restart fails an interrupted batch closed, marks uncertain rows for manual verification, and purges the matching local key version.
- Duplicate recipient addresses in one batch are rejected.

## Important limitations

### Local purge is not remote revocation

Removing encrypted material from this platform does not invalidate the API key at Blink. The UI and report therefore say **locally purged**, never remotely revoked. Institutions must create short-lived, least-privilege keys and revoke each key in the Blink dashboard immediately after a batch.

### JavaScript cannot guarantee complete memory erasure

The implementation overwrites the explicit API-key `Buffer`, deletes the request-body property, and avoids logging. Node.js, V8, TLS libraries, HTTP header serialization, garbage collection, swap, crash dumps, and infrastructure tracing may create copies that application code cannot deterministically erase. For stricter guarantees:

- isolate payment workers on hardened hosts;
- disable swap and core dumps where appropriate;
- ensure reverse proxies/APM tools never record request bodies or Blink headers;
- use short-lived remote credentials;
- prefer a Blink authorization design with narrowly scoped, one-use spend tokens if one becomes available.

### MVP worker durability

The worker is in-process. Restart handling blocks automatic resume, but an operator must reconcile any `OUTCOME_UNKNOWN` row against Blink transaction history. A scaled production deployment should use a durable queue, database lease, and a provider-supported idempotency/reconciliation mechanism before enabling multiple worker replicas.

### Master key management

A 32-byte environment secret is acceptable for this MVP but is not automatic key rotation. At larger scale, use envelope encryption with a cloud KMS or HSM, versioned data-encryption keys, audited decrypt operations, and a tested rotation runbook.

### Application-level authorization scope

The institution ID plus a valid API key for the same Blink user is the bootstrap identity. For organizations with multiple staff members, add SSO/MFA, roles, approval thresholds, and separation of batch preparation from batch authorization.

## Operational requirements

1. Use HTTPS only and set `NODE_ENV=production`.
2. Set `FRONTEND_ORIGIN` to one exact HTTPS origin.
3. Keep database access private and encrypted in transit.
4. Do not enable SQL query logging in production if it may reveal payment metadata.
5. Exclude API request bodies and headers from proxy/APM logs.
6. Alert on failed cleanup, interrupted batches, repeated permission failures, and abnormal batch totals.
7. Test on Blink staging/signet with two or three recipients before mainnet.
8. Require out-of-band approval for unusually large totals.
9. Back up audit/payment records according to policy; verify purged key fields remain null.
10. Rotate `ENCRYPTION_SECRET` through a planned re-encryption process—never replace it while active ciphertext still depends on the old key.

## Reporting a vulnerability

Do not place keys, wallet IDs, personal data, or transaction evidence in a public issue. Send a minimal reproduction through your organization's private security channel and rotate any key that may have been exposed.
