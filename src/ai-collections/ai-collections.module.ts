import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "../database/database.module";
import { AiCollectionsController } from "./ai-collections.controller";
import { AiCollectionsService } from "./ai-collections.service";
import { CredentialCryptoService } from "./security/credential-crypto.service";
import { VoiceProviderFactory } from "./telephony/voice-provider.factory";
import { TwilioVoiceProvider } from "./telephony/twilio-voice.provider";
import { ExotelVoiceProvider } from "./telephony/exotel-voice.provider";
import { KnowlarityVoiceProvider } from "./telephony/knowlarity-voice.provider";
import { SimulatorVoiceProvider } from "./telephony/simulator-voice.provider";
import { AiVoiceEngineService } from "./ai-voice/ai-voice-engine.service";
import { CollectionReconciliationService } from "./reconciliation/collection-reconciliation.service";
import { AiCollectionSchedulerService } from "./scheduler/ai-collection-scheduler.service";

@Module({
  imports: [DatabaseModule, ScheduleModule],
  controllers: [AiCollectionsController],
  providers: [
    AiCollectionsService,
    CredentialCryptoService,
    VoiceProviderFactory,
    TwilioVoiceProvider,
    ExotelVoiceProvider,
    KnowlarityVoiceProvider,
    SimulatorVoiceProvider,
    AiVoiceEngineService,
    CollectionReconciliationService,
    AiCollectionSchedulerService,
  ],
  exports: [
    AiCollectionsService,
    CollectionReconciliationService,
    AiVoiceEngineService,
  ],
})
export class AiCollectionsModule {}

