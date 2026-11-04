import { Inject, Injectable } from '@nestjs/common'
import { COIN } from '@nick-lukashik/contracts'
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { cursorCodec } from '../common/http/cursor.js'
import { wallets, walletTx } from '../db/schema.js'
import type { Db } from '../db/types.js'

const cursor = cursorCodec(
    z.object({
        createdAt: z.iso.datetime(),
        id: z.uuid(),
    }),
)

/** Reads of wallets; a wallet that never had an operation reads as zero. */
@Injectable()
export class WalletService {
    constructor(@Inject(DB) private readonly db: Db) {}

    async wallet(userId: string) {
        const [row] = await this.db
            .select()
            .from(wallets)
            .where(and(eq(wallets.userId, userId), eq(wallets.unit, COIN)))
        return {
            unit: COIN,
            balance: String(row?.balance ?? 0),
            state: row?.state ?? 'active',
            exists: Boolean(row),
            updatedAt: row?.updatedAt.toISOString() ?? null,
        }
    }

    async balances(userIds: string[]) {
        const rows = await this.db
            .select()
            .from(wallets)
            .where(and(inArray(wallets.userId, userIds), eq(wallets.unit, COIN)))
        const byUser = new Map(
            rows.map(row => [
                row.userId,
                row,
            ]),
        )
        return userIds.map(userId => {
            const row = byUser.get(userId)
            return {
                userId,
                unit: COIN,
                balance: String(row?.balance ?? 0),
                state: row?.state ?? 'active',
                exists: Boolean(row),
            }
        })
    }

    /** The player's history: kind, source and amounts, never the operator's reason or refs. */
    async history(userId: string, limit: number, from?: string, detailed = false) {
        const after = from ? cursor.decode(from) : undefined
        const rows = await this.db
            .select()
            .from(walletTx)
            .where(
                and(
                    eq(walletTx.userId, userId),
                    eq(walletTx.unit, COIN),
                    after
                        ? or(
                              lt(walletTx.createdAt, new Date(after.createdAt)),
                              and(eq(walletTx.createdAt, new Date(after.createdAt)), lt(walletTx.id, after.id)),
                          )
                        : undefined,
                ),
            )
            .orderBy(desc(walletTx.createdAt), desc(walletTx.id))
            .limit(limit + 1)
        const page = rows.slice(0, limit)
        const last = page.at(-1)
        return {
            items: page.map(row => ({
                id: row.id,
                kind: row.kind,
                source: row.source,
                amount: row.amount > 0 ? `+${row.amount}` : String(row.amount),
                balanceBefore: String(row.balanceBefore),
                balanceAfter: String(row.balanceAfter),
                createdAt: row.createdAt.toISOString(),
                ...(detailed
                    ? {
                          ref: row.ref,
                          objectRef: row.objectRef,
                          reason: row.reason,
                          actorId: row.actorId,
                          counterAccount: row.counterAccount,
                      }
                    : {}),
            })),
            nextCursor:
                rows.length > limit && last
                    ? cursor.encode({
                          createdAt: last.createdAt.toISOString(),
                          id: last.id,
                      })
                    : null,
        }
    }
}
