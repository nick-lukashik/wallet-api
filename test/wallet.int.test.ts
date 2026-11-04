import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PaymentsConsumer } from '../src/events/payments.consumer.js'
import { INTERNAL_TOKEN, startApp, type TestApp } from './harness.js'
import { type Identity, startIdentity } from './identity.js'

let identity: Identity
let t: TestApp

beforeAll(async () => {
    identity = await startIdentity()
    t = await startApp(identity)
})
afterAll(async () => {
    await t?.close()
    await identity?.close()
})

const paymentEvent = (userId: string, paymentId: string, coins = '500') => ({
    eventId: randomUUID(),
    type: 'pay.payment.succeeded.v1',
    producer: 'pay',
    occurredAt: new Date().toISOString(),
    aggregateId: paymentId,
    payload: {
        paymentId,
        userId,
        productKey: 'coins-500',
        coins,
        amount: '5',
        currency: 'RUB',
        provider: 'fake',
        paidAt: new Date().toISOString(),
    },
})

const internal = (path: string, body: Record<string, unknown>) =>
    t.http().post(`/api/v1/internal/${path}`).set('authorization', `Bearer ${INTERNAL_TOKEN}`).send(body)

async function funded(coins = '500') {
    const userId = randomUUID()
    await t.app.get(PaymentsConsumer).handle(paymentEvent(userId, randomUUID(), coins))
    return userId
}

describe('credits from payments', () => {
    it('credits a pack once, however often the event or the payment repeats', async () => {
        const userId = randomUUID()
        const paymentId = randomUUID()
        const consumer = t.app.get(PaymentsConsumer)
        const event = paymentEvent(userId, paymentId)
        await expect(consumer.handle(event)).resolves.toBe('processed')
        await expect(consumer.handle(event)).resolves.toBe('duplicate')
        // The same payment in a new envelope: the ref deduplicates it.
        await consumer.handle(paymentEvent(userId, paymentId))

        const token = await identity.token(userId)
        const wallet = await t.http().get('/api/v1/me/wallet').set('authorization', `Bearer ${token}`).expect(200)
        expect(wallet.body).toMatchObject({
            unit: 'COIN',
            balance: '500',
            exists: true,
        })
        const history = await t
            .http()
            .get('/api/v1/me/wallet/history')
            .set('authorization', `Bearer ${token}`)
            .expect(200)
        expect(history.body.items).toHaveLength(1)
        expect(history.body.items[0]).toEqual(
            expect.objectContaining({
                kind: 'credit',
                source: 'pay',
                amount: '+500',
            }),
        )
        // The player sees no refs or reasons.
        expect(history.body.items[0].ref).toBeUndefined()

        const events = await t.db.execute<{
            type: string
        }>(sql`select type from outbox where envelope->>'aggregateId' = ${userId}`)
        expect(events.rows.map(row => row.type)).toEqual([
            'wallet.credit.posted.v1',
        ])
    })

    it('reads zero for a user without operations', async () => {
        const token = await identity.token(randomUUID())
        const wallet = await t.http().get('/api/v1/me/wallet').set('authorization', `Bearer ${token}`).expect(200)
        expect(wallet.body).toMatchObject({
            balance: '0',
            exists: false,
        })
    })
})

describe('internal debits', () => {
    it('needs the service token', async () => {
        await t
            .http()
            .post('/api/v1/internal/debit')
            .send({
                ref: 'order:1',
                userId: randomUUID(),
                amount: '1',
                source: 'roulette',
            })
            .expect(401)
    })

    it('debits, replays the same ref and refuses a changed one or too much', async () => {
        const userId = await funded('500')
        const ref = `bet:${randomUUID()}`
        const first = await internal('debit', {
            ref,
            userId,
            amount: '120',
            source: 'roulette',
            objectRef: 'round:1',
        }).expect(200)
        expect(first.body).toMatchObject({
            amount: '-120',
            balanceBefore: '500',
            balanceAfter: '380',
            replayed: false,
        })
        const again = await internal('debit', {
            ref,
            userId,
            amount: '120',
            source: 'roulette',
        }).expect(200)
        expect(again.body).toMatchObject({
            txId: first.body.txId,
            replayed: true,
        })
        await internal('debit', {
            ref,
            userId,
            amount: '121',
            source: 'roulette',
        }).expect(409)
        const tooMuch = await internal('debit', {
            ref: `bet:${randomUUID()}`,
            userId,
            amount: '381',
            source: 'roulette',
        }).expect(402)
        expect(tooMuch.body.code).toBe('INSUFFICIENT_FUNDS')
        await internal('debit', {
            ref: 'grant:sneaky',
            userId,
            amount: '1',
            source: 'roulette',
        }).expect(400)

        const balances = await internal('balances', {
            userIds: [
                userId,
            ],
        }).expect(200)
        expect(balances.body.items[0].balance).toBe('380')
    })
})

describe('operators', () => {
    it('lets wallet.adjust grant and adjust within limits, and refuses support', async () => {
        const userId = await funded('100')
        const owner = await identity.token(randomUUID(), [
            'owner',
        ])
        const support = await identity.token(randomUUID(), [
            'support',
        ])
        const command = (amount: string) => ({
            amount,
            reason: 'compensation for a bug',
            commandId: randomUUID(),
        })
        await t
            .http()
            .post(`/api/v1/admin/wallets/${userId}/grant`)
            .set('authorization', `Bearer ${support}`)
            .send(command('10'))
            .expect(403)
        const granted = await t
            .http()
            .post(`/api/v1/admin/wallets/${userId}/grant`)
            .set('authorization', `Bearer ${owner}`)
            .send(command('50'))
            .expect(200)
        expect(granted.body.balanceAfter).toBe('150')
        await t
            .http()
            .post(`/api/v1/admin/wallets/${userId}/grant`)
            .set('authorization', `Bearer ${owner}`)
            .send(command('10001'))
            .expect(400)
        await t
            .http()
            .post(`/api/v1/admin/wallets/${userId}/adjust`)
            .set('authorization', `Bearer ${owner}`)
            .send(command('151'))
            .expect(402)

        const view = await t
            .http()
            .get(`/api/v1/admin/wallets/${userId}`)
            .set('authorization', `Bearer ${owner}`)
            .expect(200)
        expect(view.body.history.items[0]).toMatchObject({
            kind: 'grant',
            reason: 'compensation for a bug',
        })
    })
})

describe('ledger invariants', () => {
    it('keeps the ledger append-only and the books at zero', async () => {
        await funded('7')
        const refusal = (statement: Promise<unknown>) =>
            statement.then(
                () => 'applied',
                (error: Error) => String((error.cause as Error | undefined)?.message ?? error.message),
            )
        expect(await refusal(t.db.execute(sql`update wallet_tx set amount = amount + 1`))).toMatch(/append-only/)
        expect(await refusal(t.db.execute(sql`delete from wallet_tx`))).toMatch(/append-only/)
        const sums = await t.db.execute<{
            total: string
        }>(
            sql`select (select coalesce(sum(balance), 0) from wallets) + (select coalesce(sum(balance), 0) from system_accounts) as total`,
        )
        expect(Number(sums.rows[0]?.total)).toBe(0)
    })
})
