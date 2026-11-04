import { Module } from '@nestjs/common'
import { AdminWalletsController } from './admin/admin.controller.js'
import { PaymentsConsumer } from './events/payments.consumer.js'
import { InternalController } from './internal/internal.controller.js'
import { LedgerService } from './ledger/ledger.service.js'
import { MeWalletController } from './wallet/me.controller.js'
import { WalletService } from './wallet/wallet.service.js'

@Module({
    controllers: [
        MeWalletController,
        InternalController,
        AdminWalletsController,
    ],
    providers: [
        LedgerService,
        PaymentsConsumer,
        WalletService,
    ],
})
export class WalletModule {}
