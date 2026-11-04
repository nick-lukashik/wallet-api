import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Internal } from '@nick-lukashik/auth/nest'
import { LedgerService } from '../ledger/ledger.service.js'
import {
    type BalancesInput,
    balancesSchema,
    type InternalOperation,
    internalOperationSchema,
    type RefsInput,
    refsSchema,
} from '../wallet/schemas.js'
import { WalletService } from '../wallet/wallet.service.js'

/** Other services inside the cluster, with this service's token: stakes, payouts, refunds, what the ledger has. */
@ApiExcludeController()
@Controller('internal')
@Internal()
export class InternalController {
    constructor(
        private readonly ledger: LedgerService,
        private readonly wallets: WalletService,
    ) {}

    @Post('debit')
    @HttpCode(HttpStatus.OK)
    debit(
        @Body({
            schema: internalOperationSchema,
        })
        body: InternalOperation,
    ) {
        return this.ledger.post({
            ...body,
            kind: 'debit',
            amount: Number(body.amount),
            counterAccount: 'spent',
        })
    }

    @Post('credit')
    @HttpCode(HttpStatus.OK)
    credit(
        @Body({
            schema: internalOperationSchema,
        })
        body: InternalOperation,
    ) {
        return this.ledger.post({
            ...body,
            kind: 'credit',
            amount: Number(body.amount),
            counterAccount: body.source === 'daily-bonus' ? 'issued_bonus' : 'spent',
        })
    }

    @Post('balances')
    @HttpCode(HttpStatus.OK)
    async balances(
        @Body({
            schema: balancesSchema,
        })
        body: BalancesInput,
    ) {
        return {
            items: await this.wallets.balances(body.userIds),
        }
    }

    /** Read-only: pay-api's reconciliation asks which payments reached the ledger. */
    @Post('refs')
    @HttpCode(HttpStatus.OK)
    async refs(
        @Body({
            schema: refsSchema,
        })
        body: RefsInput,
    ) {
        return {
            found: await this.ledger.knownRefs(body.refs),
        }
    }
}
