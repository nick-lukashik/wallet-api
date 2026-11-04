import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { paymentSucceededV1 } from '@nick-lukashik/contracts'
import { DB } from '../common/database/database.js'
import { defineEvent, type Envelope } from '../common/messaging/event.js'
import { processOnce } from '../common/messaging/inbox.js'
import { PermanentError, RabbitMq } from '../common/messaging/rabbitmq.js'
import { defineQueue } from '../common/messaging/topology.js'
import type { Db } from '../db/types.js'
import { LedgerService } from '../ledger/ledger.service.js'

const paymentSucceeded = defineEvent(paymentSucceededV1.type, paymentSucceededV1.producer, paymentSucceededV1.payload)

export const paymentsQueue = defineQueue('wallet-api.payments', [
    {
        producer: paymentSucceeded.producer,
        types: [
            paymentSucceeded.type,
        ],
    },
])

/**
 * A confirmed payment → the GRM pack on the wallet, once: the inbox and the
 * ref `pack:payment:<paymentId>` both deduplicate, in one transaction.
 */
@Injectable()
export class PaymentsConsumer implements OnApplicationBootstrap {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly rabbit: RabbitMq,
        private readonly ledger: LedgerService,
    ) {}

    async onApplicationBootstrap() {
        await this.rabbit.subscribe(paymentsQueue, async event => {
            await this.handle(event)
        })
    }

    handle(envelope: Envelope) {
        const parsed = paymentSucceeded.schema.safeParse(envelope)
        if (!parsed.success) throw new PermanentError('invalid payload')
        const event = parsed.data
        return processOnce(
            this.db,
            {
                consumer: paymentsQueue.name,
                eventId: event.eventId,
                type: event.type,
            },
            async tx => {
                await this.ledger.postIn(tx, {
                    ref: `pack:payment:${event.payload.paymentId}`,
                    userId: event.payload.userId,
                    kind: 'credit',
                    amount: Number(event.payload.grm),
                    source: 'pay',
                    counterAccount: 'issued_purchase',
                    objectRef: `payment:${event.payload.paymentId}`,
                    correlationId: event.correlationId ?? event.eventId,
                })
            },
        )
    }
}
