import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Authenticated, Caller } from '@nick-lukashik/auth/nest'
import { ApiErrors } from '../common/openapi/openapi.js'
import { type HistoryQuery, historyQuerySchema } from './schemas.js'
import { WalletService } from './wallet.service.js'

/** The caller's own wallet only. */
@ApiTags('wallet')
@ApiBearerAuth()
@Controller('me/wallet')
@Authenticated()
export class MeWalletController {
    constructor(private readonly wallets: WalletService) {}

    @Get()
    @ApiOperation({
        summary: 'Balance in GRM; "0" and exists: false before the first operation',
    })
    @ApiErrors(401)
    wallet(@Caller() caller: AccessClaims) {
        return this.wallets.wallet(caller.userId)
    }

    @Get('history')
    @ApiOperation({
        summary: 'Operations, newest first: kind, source, amount, balance before and after',
    })
    @ApiErrors(400, 401)
    history(
        @Caller() caller: AccessClaims,
        @Query({
            schema: historyQuerySchema,
        })
        query: HistoryQuery,
    ) {
        return this.wallets.history(caller.userId, query.limit, query.cursor)
    }
}
