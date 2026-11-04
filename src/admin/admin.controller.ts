import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Authenticated, Caller } from '@nick-lukashik/auth/nest'
import { AppError } from '../common/http/app-error.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import { walletConfig } from '../config/config.js'
import { LedgerService } from '../ledger/ledger.service.js'
import { type AdminCommand, adminCommandSchema, type HistoryQuery, historyQuerySchema } from '../wallet/schemas.js'
import { WalletService } from '../wallet/wallet.service.js'

/** Operators: wallet.read to look, wallet.adjust to grant or take coins, with a reason. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/wallets')
export class AdminWalletsController {
    constructor(
        private readonly ledger: LedgerService,
        private readonly wallets: WalletService,
        @Inject(walletConfig.KEY) private readonly config: ConfigType<typeof walletConfig>,
    ) {}

    @Get(':userId')
    @Authenticated('wallet.read')
    @ApiOperation({
        summary: 'A wallet and its full ledger: refs, reasons, authors',
    })
    @ApiErrors(400, 401, 403)
    async get(
        @Param('userId', new ParseUUIDPipe()) userId: string,
        @Query({
            schema: historyQuerySchema,
        })
        query: HistoryQuery,
    ) {
        return {
            wallet: await this.wallets.wallet(userId),
            history: await this.wallets.history(userId, query.limit, query.cursor, true),
        }
    }

    @Post(':userId/grant')
    @HttpCode(HttpStatus.OK)
    @Authenticated('wallet.adjust')
    @ApiOperation({
        summary: 'Credit coins (promo, compensation); commandId makes a retry safe',
    })
    @ApiErrors(400, 401, 403, 409)
    grant(
        @Caller() caller: AccessClaims,
        @Param('userId', new ParseUUIDPipe()) userId: string,
        @Body({
            schema: adminCommandSchema,
        })
        body: AdminCommand,
    ) {
        return this.command('grant', caller, userId, body)
    }

    @Post(':userId/adjust')
    @HttpCode(HttpStatus.OK)
    @Authenticated('wallet.adjust')
    @ApiOperation({
        summary: 'Take coins away; 402 when the balance is lower',
    })
    @ApiErrors(400, 401, 402, 403, 409)
    adjust(
        @Caller() caller: AccessClaims,
        @Param('userId', new ParseUUIDPipe()) userId: string,
        @Body({
            schema: adminCommandSchema,
        })
        body: AdminCommand,
    ) {
        return this.command('adjust', caller, userId, body)
    }

    private command(kind: 'grant' | 'adjust', caller: AccessClaims, userId: string, body: AdminCommand) {
        const amount = Number(body.amount)
        if (amount > this.config.adminMaxAmount)
            throw new AppError('VALIDATION_FAILED', 'Request validation failed', [
                {
                    path: 'amount',
                    message: `at most ${this.config.adminMaxAmount} per command`,
                },
            ])
        return this.ledger.post({
            ref: `${kind}:${body.commandId}`,
            userId,
            kind,
            amount,
            source: 'admin',
            counterAccount: kind === 'grant' ? 'issued_bonus' : 'adjust',
            reason: body.reason,
            actorId: caller.userId,
        })
    }
}
