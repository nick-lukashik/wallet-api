import { createHash, randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { COIN, walletCreditedV1 } from '@nick-lukashik/contracts'
import { and, eq, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { AppError } from '../common/http/app-error.js'
import { defineEvent } from '../common/messaging/event.js'
import { enqueueEvent } from '../common/messaging/outbox.js'
import { systemAccounts, walletRefs, wallets, walletTx } from '../db/schema.js'
import type { Db, Tx, WalletTxRow } from '../db/types.js'

export const walletCredited = defineEvent(walletCreditedV1.type, walletCreditedV1.producer, walletCreditedV1.payload)

export type Kind = 'credit' | 'debit' | 'grant' | 'adjust'
export type Source = 'pay' | 'admin' | 'roulette' | 'daily-bonus'
type SystemAccount = 'issued_purchase' | 'issued_bonus' | 'spent' | 'adjust'

export type Operation = {
    ref: string
    userId: string
    kind: Kind
    /** Positive; the sign comes from the kind. */
    amount: number
    source: Source
    counterAccount: SystemAccount
    objectRef?: string
    reason?: string
    actorId?: string
    correlationId?: string
}

export type Posted = {
    txId: string
    ref: string
    userId: string
    unit: typeof COIN
    kind: Kind
    source: string
    objectRef: string | null
    amount: string
    balanceBefore: string
    balanceAfter: string
    createdAt: string
    replayed: boolean
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value))

/**
 * Every balance change goes through `post`: one transaction that takes the
 * ref, locks the wallet row, checks the balance, writes both legs and the
 * ledger row, and (for credits) the event. A repeated ref with the same
 * request returns the stored result; with different data it is a 409.
 * A refusal (402, 423) rolls everything back, so the ref can be retried.
 */
@Injectable()
export class LedgerService {
    constructor(@Inject(DB) private readonly db: Db) {}

    post(operation: Operation): Promise<Posted> {
        return this.db.transaction(tx => this.postIn(tx, operation))
    }

    /** The same inside a caller's transaction (the inbox of an event). */
    async postIn(tx: Tx, operation: Operation): Promise<Posted> {
        if (!Number.isSafeInteger(operation.amount) || operation.amount <= 0)
            throw new AppError('VALIDATION_FAILED', 'amount must be a positive whole number')
        const fingerprint = createHash('sha256')
            .update(
                [
                    operation.kind,
                    operation.userId,
                    COIN,
                    operation.amount,
                    operation.source,
                ].join('|'),
            )
            .digest('hex')
        const txId = randomUUID()
        const [taken] = await tx
            .insert(walletRefs)
            .values({
                ref: operation.ref,
                operation: operation.kind,
                txId,
                fingerprint,
            })
            .onConflictDoNothing()
            .returning({
                ref: walletRefs.ref,
            })
        if (!taken) return this.replay(tx, operation.ref, fingerprint)

        await tx
            .insert(wallets)
            .values({
                userId: operation.userId,
                unit: COIN,
            })
            .onConflictDoNothing()
        const [wallet] = await tx
            .select()
            .from(wallets)
            .where(and(eq(wallets.userId, operation.userId), eq(wallets.unit, COIN)))
            .for('update')
        if (!wallet) throw new Error('wallet row vanished')

        const delta = operation.kind === 'debit' || operation.kind === 'adjust' ? -operation.amount : operation.amount
        if (delta < 0 && operation.kind === 'debit' && wallet.state === 'restricted')
            throw new AppError('LOCKED', 'Wallet restricted')
        if (wallet.balance + delta < 0) throw new AppError('INSUFFICIENT_FUNDS', 'Not enough coins')

        const balanceAfter = wallet.balance + delta
        const version = wallet.version + 1
        await tx
            .update(wallets)
            .set({
                balance: balanceAfter,
                version,
                updatedAt: new Date(),
            })
            .where(and(eq(wallets.userId, operation.userId), eq(wallets.unit, COIN)))
        await tx
            .insert(systemAccounts)
            .values({
                code: operation.counterAccount,
                unit: COIN,
                balance: -delta,
            })
            .onConflictDoUpdate({
                target: [
                    systemAccounts.code,
                    systemAccounts.unit,
                ],
                set: {
                    balance: sql`${systemAccounts.balance} + ${-delta}`,
                },
            })
        const [row] = await tx
            .insert(walletTx)
            .values({
                id: txId,
                userId: operation.userId,
                unit: COIN,
                kind: operation.kind,
                source: operation.source,
                objectRef: operation.objectRef ?? null,
                ref: operation.ref,
                amount: delta,
                balanceBefore: wallet.balance,
                balanceAfter,
                walletVersion: version,
                counterAccount: operation.counterAccount,
                reason: operation.reason ?? null,
                actorId: operation.actorId ?? null,
                correlationId: operation.correlationId ?? null,
            })
            .returning()
        if (!row) throw new Error('ledger insert returned nothing')

        if (delta > 0) {
            await enqueueEvent(
                tx,
                walletCredited.create({
                    aggregateId: operation.userId,
                    payload: {
                        txId: row.id,
                        userId: row.userId,
                        unit: COIN,
                        amount: String(delta),
                        balanceAfter: String(balanceAfter),
                        source: operation.source,
                        ref: row.ref,
                        createdAt: row.createdAt.toISOString(),
                    },
                }),
            )
        }
        return toPosted(row, false)
    }

    private async replay(tx: Tx, ref: string, fingerprint: string): Promise<Posted> {
        const [existing] = await tx.select().from(walletRefs).where(eq(walletRefs.ref, ref))
        if (!existing || existing.fingerprint !== fingerprint)
            throw new AppError('CONFLICT', 'The ref was used for a different operation', [
                {
                    path: 'ref',
                    message: 'conflict',
                },
            ])
        const [row] = await tx.select().from(walletTx).where(eq(walletTx.id, existing.txId))
        if (!row) throw new Error('ref without its ledger row')
        return toPosted(row, true)
    }
}

export function toPosted(row: WalletTxRow, replayed: boolean): Posted {
    return {
        txId: row.id,
        ref: row.ref,
        userId: row.userId,
        unit: COIN,
        kind: row.kind,
        source: row.source,
        objectRef: row.objectRef,
        amount: signed(row.amount),
        balanceBefore: String(row.balanceBefore),
        balanceAfter: String(row.balanceAfter),
        createdAt: row.createdAt.toISOString(),
        replayed,
    }
}
