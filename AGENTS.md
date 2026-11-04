# AGENTS.md

wallet-api: the coin ledger. Built from nest-example; `src/common/` stays identical to it, except the error codes in `app-error.ts` (adds INSUFFICIENT_FUNDS 402 and LOCKED 423), `error.filter.ts` and `openapi.ts`. Human docs: `README.md`.

## Rules

- Every balance change goes through `LedgerService.post` / `postIn`. Nothing else writes `wallets`, `wallet_tx`, `wallet_refs` or `system_accounts`.
- `wallet_tx` and `wallet_refs` are append-only (database trigger). A correction is a new operation, never an UPDATE. Tests must not truncate them: use fresh user ids and refs.
- Amounts are whole coins, strings in DTOs. Lock order: the wallet row, then the system account.
- `pnpm verify` must be green before you hand work over.
