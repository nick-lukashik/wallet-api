import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { connect } from 'amqplib'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { confirmedPublisher } from '../src/common/messaging/confirm.js'
import { RabbitMq } from '../src/common/messaging/rabbitmq.js'
import { defineQueue, eventsExchange, queueDeclarations } from '../src/common/messaging/topology.js'
import { walletRefs } from '../src/db/schema.js'
import { paymentsQueue } from '../src/events/payments.consumer.js'
import { walletCredited } from '../src/ledger/ledger.service.js'
import { startOwnRabbitMq } from './containers.js'
import { startApp, type TestApp } from './harness.js'
import { type Identity, startIdentity } from './identity.js'

/**
 * A copy of gitops platform/data/stores/rabbitmq-topology.json, the file the
 * broker loads at boot. A change of this service's queues changes that file too.
 */
const TOPOLOGY = readFileSync(new URL('./fixtures/rabbitmq-topology.json', import.meta.url), 'utf8')
const topology = JSON.parse(TOPOLOGY) as {
    exchanges: {
        name: string
        type: string
        durable: boolean
    }[]
    queues: {
        name: string
        durable: boolean
        arguments: Record<string, unknown>
    }[]
    bindings: {
        source: string
        destination: string
        routing_key: string
    }[]
}

/** The stand-in for the sealed users: the client of the container's URL (guest, guest). */
const users = () => {
    const salt = randomBytes(4)
    const hash = createHash('sha256').update(salt).update('guest').digest()
    return JSON.stringify({
        users: [
            {
                name: 'guest',
                password_hash: Buffer.concat([
                    salt,
                    hash,
                ]).toString('base64'),
                hashing_algorithm: 'rabbit_password_hashing_sha256',
                tags: [],
            },
        ],
        vhosts: [
            {
                name: '/',
            },
        ],
        permissions: [
            {
                user: 'guest',
                vhost: '/',
                configure: '.*',
                write: '.*',
                read: '.*',
            },
        ],
    })
}

/** A broker that loads the topology and the users from a directory, as in the cluster. */
const brokerWithDefinitions = () =>
    startOwnRabbitMq(
        {
            RABBITMQ_CONFIG_FILE: '/etc/rabbitmq/conf/rabbitmq.conf',
        },
        [
            {
                content: 'load_definitions = /etc/rabbitmq/definitions\nloopback_users = none\n',
                target: '/etc/rabbitmq/conf/rabbitmq.conf',
            },
            {
                content: TOPOLOGY,
                target: '/etc/rabbitmq/definitions/10-topology.json',
            },
            {
                content: users(),
                target: '/etc/rabbitmq/definitions/20-users.json',
            },
        ],
    )

const paymentEvent = () => {
    const paymentId = randomUUID()
    return {
        eventId: paymentId,
        type: 'pay.payment.succeeded.v1',
        producer: 'pay',
        occurredAt: new Date().toISOString(),
        aggregateId: paymentId,
        payload: {
            paymentId,
            userId: randomUUID(),
            productKey: 'coins-500',
            coins: '500',
            amount: '5',
            currency: 'RUB',
            provider: 'fake',
            paidAt: new Date().toISOString(),
        },
    }
}

/** What pay-api's relay does: mandatory, confirmed by the broker. */
async function publishAsPayApi(url: string, event: ReturnType<typeof paymentEvent>) {
    const connection = await connect(url)
    try {
        const channel = await connection.createConfirmChannel()
        await confirmedPublisher(channel)('pay.events', event.type, Buffer.from(JSON.stringify(event)), {
            persistent: true,
        })
    } finally {
        await connection.close()
    }
}

describe('the broker definitions', () => {
    let identity: Identity
    const stops: (() => Promise<unknown>)[] = []

    beforeAll(async () => {
        identity = await startIdentity()
    })
    afterEach(async () => {
        for (const stop of stops.splice(0).reverse()) await stop()
    })
    afterAll(async () => {
        await identity?.close()
    })

    /** wallet-api starting for the first time, with its real consumer. */
    const startWallet = async (url: string) => {
        const app: TestApp = await startApp(identity, {
            RABBITMQ_URL: url,
        })
        stops.push(() => app.close())
        await expect.poll(() => app.app.get(RabbitMq).consumerStates()[paymentsQueue.name]).toBe('up')
        return app
    }

    const refs = (app: TestApp, event: ReturnType<typeof paymentEvent>) =>
        app.db
            .select()
            .from(walletRefs)
            .where(eq(walletRefs.ref, `pack:payment:${event.payload.paymentId}`))

    it('declare what this service declares', () => {
        const mine = topology.queues.filter(
            queue => queue.name === paymentsQueue.name || queue.name.startsWith(`${paymentsQueue.name}.`),
        )
        expect(
            mine.map(queue => ({
                name: queue.name,
                arguments: queue.arguments,
            })),
        ).toEqual(queueDeclarations(paymentsQueue))
        expect(mine.every(queue => queue.durable)).toBe(true)
        expect(
            topology.bindings
                .filter(binding => binding.destination === paymentsQueue.name)
                .map(binding => ({
                    exchange: binding.source,
                    routingKey: binding.routing_key,
                })),
        ).toEqual(paymentsQueue.bindings)
        for (const name of [
            eventsExchange(walletCredited.producer),
            ...paymentsQueue.bindings.map(binding => binding.exchange),
        ])
            expect(topology.exchanges).toContainEqual(
                expect.objectContaining({
                    name,
                    type: 'topic',
                    durable: true,
                }),
            )
    })

    it('keep an event published before wallet-api ever started, and it is credited once', async () => {
        const broker = await brokerWithDefinitions()
        stops.push(() => broker.container.stop())
        const event = paymentEvent()

        await publishAsPayApi(broker.url, event)
        const app = await startWallet(broker.url)

        // A fresh broker and a fresh service on a busy CI runner: the default wait ran out there.
        await expect
            .poll(() => refs(app, event), {
                timeout: 25_000,
            })
            .toHaveLength(1)
        expect(await app.metric('messaging_consumer_restarts_total')).toBe(0)
    }, 120_000)

    it('are what makes that work: without them the event reaches only the queues that exist', async () => {
        const broker = await startOwnRabbitMq(
            {
                RABBITMQ_CONFIG_FILE: '/etc/rabbitmq/conf/rabbitmq.conf',
            },
            [
                {
                    content: 'loopback_users = none\n',
                    target: '/etc/rabbitmq/conf/rabbitmq.conf',
                },
            ],
        )
        stops.push(() => broker.container.stop())
        // Another consumer is up: the broker confirms the publish, and pay-api marks the event published.
        const connection = await connect(broker.url)
        const channel = await connection.createChannel()
        const other = defineQueue('notifications-api.events', [
            {
                producer: 'pay',
                types: [
                    'pay.payment.succeeded.v1',
                ],
            },
        ])
        for (const queue of queueDeclarations(other))
            await channel.assertQueue(queue.name, {
                durable: true,
                arguments: queue.arguments,
            })
        await channel.assertExchange('pay.events', 'topic', {
            durable: true,
        })
        await channel.bindQueue(other.name, 'pay.events', 'pay.payment.succeeded.v1')
        await connection.close()
        const event = paymentEvent()

        await publishAsPayApi(broker.url, event)
        const app = await startWallet(broker.url)

        await new Promise(resolve => setTimeout(resolve, 2_000))
        expect(await refs(app, event)).toEqual([])
    }, 120_000)
})
