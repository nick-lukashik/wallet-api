import { sql } from 'drizzle-orm'
import {
    bigint,
    check,
    index,
    integer,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core'

// Platform tables every service with events carries: outbox and inbox.
export { inbox, outbox } from '../common/messaging/outbox.schema.js'

/** Millisecond precision, so an ISO string from JSON round-trips exactly (cursors). */
const at = (name: string) =>
    timestamp(name, {
        withTimezone: true,
        precision: 3,
    })
const amount = (name: string) =>
    bigint(name, {
        mode: 'number',
    })

/** A wallet: one per user and unit, created by its first operation. `balance` caches the ledger. */
export const wallets = pgTable(
    'wallets',
    {
        userId: uuid('user_id').notNull(),
        unit: text('unit').notNull(),
        balance: amount('balance').notNull().default(0),
        state: text('state', {
            enum: [
                'active',
                'restricted',
            ],
        })
            .notNull()
            .default('active'),
        version: integer('version').notNull().default(0),
        createdAt: at('created_at').notNull().defaultNow(),
        updatedAt: at('updated_at').notNull().defaultNow(),
    },
    t => [
        primaryKey({
            columns: [
                t.userId,
                t.unit,
            ],
        }),
        check('wallets_balance_non_negative', sql`${t.balance} >= 0`),
    ],
)

/**
 * The ledger: the player's leg of every operation. INSERT only: a trigger
 * (migration 0001) refuses UPDATE, DELETE and TRUNCATE for every role.
 * The other leg is `counter_account` with `-amount`.
 */
export const walletTx = pgTable(
    'wallet_tx',
    {
        id: uuid('id').primaryKey(),
        userId: uuid('user_id').notNull(),
        unit: text('unit').notNull(),
        kind: text('kind', {
            enum: [
                'credit',
                'debit',
                'grant',
                'adjust',
            ],
        }).notNull(),
        source: text('source').notNull(),
        objectRef: text('object_ref'),
        ref: text('ref').notNull(),
        /** Signed: + credited, - debited. */
        amount: amount('amount').notNull(),
        balanceBefore: amount('balance_before').notNull(),
        balanceAfter: amount('balance_after').notNull(),
        walletVersion: integer('wallet_version').notNull(),
        counterAccount: text('counter_account').notNull(),
        reason: text('reason'),
        actorId: text('actor_id'),
        correlationId: text('correlation_id'),
        createdAt: at('created_at').notNull().defaultNow(),
    },
    t => [
        index('wallet_tx_user_idx').on(t.userId, t.unit, t.createdAt.desc(), t.id.desc()),
        // A second line behind wallet_refs: the same ref never makes two ledger rows.
        uniqueIndex('wallet_tx_ref_key').on(t.ref),
        check('wallet_tx_chain', sql`${t.balanceAfter} = ${t.balanceBefore} + ${t.amount}`),
        check('wallet_tx_amount_not_zero', sql`${t.amount} <> 0`),
    ],
)

/**
 * Idempotency: a ref is taken by one operation with one request fingerprint, forever.
 * INSERT only, like the ledger (triggers of migrations 0001 and 0002): without its refs
 * the same operation would post again.
 */
export const walletRefs = pgTable('wallet_refs', {
    ref: text('ref').primaryKey(),
    operation: text('operation').notNull(),
    txId: uuid('tx_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
})

/** The second leg of every operation; with all wallets their balances sum to zero per unit. */
export const systemAccounts = pgTable(
    'system_accounts',
    {
        code: text('code', {
            enum: [
                'issued_purchase',
                'issued_bonus',
                'spent',
                'adjust',
            ],
        }).notNull(),
        unit: text('unit').notNull(),
        balance: amount('balance').notNull().default(0),
    },
    t => [
        primaryKey({
            columns: [
                t.code,
                t.unit,
            ],
        }),
    ],
)
