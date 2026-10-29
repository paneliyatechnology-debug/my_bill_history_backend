import { Module } from "@nestjs/common";
import { SharedLedgerController } from "./shared-ledger.controller";
import { SharedLedgerService } from "./shared-ledger.service";

@Module({
  controllers: [SharedLedgerController],
  providers: [SharedLedgerService],
  exports: [SharedLedgerService],
})
export class SharedLedgerModule {}
