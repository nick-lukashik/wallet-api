# wallet-api

The coin wallet of the nick-lukashik platform. Coins (unit `COIN`) are the one internal unit: whole numbers, no cash-out, no transfers between people. They are bought through pay-api and spent by games through the internal API. pay-api is not live yet: it is not deployed and payments are off in prod, so nobody can buy coins today.

Built from [`nest-example`](https://github.com/nick-lukashik/nest-example): Postgres, RabbitMQ outbox and inbox. Design: [`.github/docs/identity.md`](https://github.com/nick-lukashik/.github/blob/master/docs/identity.md). The contract is ported from the previous platform's `wallet-backend`. No public route.

## Ledger

| Table             | Holds                                                                                                                               | Guarantee                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `wallets`         | `(user_id, unit)`, `balance`, `state` (`active` / `restricted`), `version`                                                          | `balance >= 0`; changed only by an operation, in its transaction                                    |
| `wallet_tx`       | the player's leg of every operation: kind, source, ref, signed amount, balance before and after, the second account, reason, author | INSERT only (trigger, migration `0001`); one row per ref; `balance_after = balance_before + amount` |
| `wallet_refs`     | `ref` → the operation and a SHA-256 fingerprint of the request                                                                      | INSERT only: a ref means one operation forever                                                      |
| `system_accounts` | the second leg: `issued_purchase`, `issued_bonus`, `spent`, `adjust`                                                                | with all wallets the sum per unit is zero                                                           |

How one operation runs, in one transaction:
1. Take the ref.
2. Lock the wallet row.
3. Check the state and the balance.
4. Write both legs and the ledger row.
5. Put the event in the outbox, for a credit.

When the ref is already taken:
- the same request gets the stored result (`replayed: true`);
- a different one gets 409.

A refusal (402 `INSUFFICIENT_FUNDS`, 423 `LOCKED`) rolls back, so the same ref can be tried again later.

## API (`/api/v1`)

| Route                                                                                                  | Who             | What                                                                                               |
| ------------------------------------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------- |
| `GET /me/wallet`, `GET /me/wallet/history?limit&cursor`                                                | access token    | The caller's balance and operations; no refs, reasons or authors                                   |
| `POST /internal/debit`, `POST /internal/credit` `{ ref, userId, amount, source, objectRef?, reason? }` | service token   | Stakes, payouts, refunds of other services. The prefixes `grant:`, `adjust:`, `pack:` are reserved |
| `POST /internal/balances` `{ userIds }`                                                                | service token   | Balances of up to 1000 users                                                                       |
| `POST /internal/refs` `{ refs }`                                                                       | service token   | Read-only: which of up to 1000 refs the ledger has, `{ found }` (pay-api's reconciliation)         |
| `GET /admin/wallets/:userId`                                                                           | `wallet.read`   | Wallet and full ledger                                                                             |
| `POST /admin/wallets/:userId/grant` and `.../adjust` `{ amount, reason, commandId }`                   | `wallet.adjust` | Operator credit or debit with a reason, at most `WALLET_ADMIN_MAX_AMOUNT`; ref `grant:<commandId>` |

## Events

| Direction                              | Event                      | Effect                                                                           |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| consumed (queue `wallet-api.payments`) | `pay.payment.succeeded.v1` | Credit `coins`, ref `pack:payment:<paymentId>`, second account `issued_purchase` |
| published                              | `wallet.credit.posted.v1`  | Every credit (notifications-api adds an inbox entry)                             |

Not yet:
- the reconciliation pass (balance drift, chain breaks, zero sum);
- rollback of a debit;
- restricting wallets on `id` account events.

## Commands

```bash
pnpm install
pnpm infra:up      # Postgres, RabbitMQ (ports 5443, 5683)
pnpm env:local
pnpm db:migrate
pnpm dev           # http://localhost:4300
pnpm verify
pnpm messaging:replay-dlq wallet-api.payments --limit 100   # dead letters back to their queue, after the cause is fixed
```
