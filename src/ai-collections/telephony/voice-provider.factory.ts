import { Injectable, BadRequestException } from "@nestjs/common";
import { IVoiceProvider } from "./voice-provider.interface";
import { TwilioVoiceProvider } from "./twilio-voice.provider";
import { ExotelVoiceProvider } from "./exotel-voice.provider";
import { KnowlarityVoiceProvider } from "./knowlarity-voice.provider";
import { SimulatorVoiceProvider } from "./simulator-voice.provider";

@Injectable()
export class VoiceProviderFactory {
  private readonly providers: Map<string, IVoiceProvider> = new Map();

  constructor(
    private readonly twilioProvider: TwilioVoiceProvider,
    private readonly exotelProvider: ExotelVoiceProvider,
    private readonly knowlarityProvider: KnowlarityVoiceProvider,
    private readonly simulatorProvider: SimulatorVoiceProvider,
  ) {
    this.providers.set(twilioProvider.name, twilioProvider);
    this.providers.set(exotelProvider.name, exotelProvider);
    this.providers.set(knowlarityProvider.name, knowlarityProvider);
    this.providers.set(simulatorProvider.name, simulatorProvider);
  }

  getProvider(providerName?: string | null): IVoiceProvider {
    const normalized = (providerName || "twilio").toLowerCase().trim();
    const provider = this.providers.get(normalized);
    if (!provider) {
      throw new BadRequestException(
        `Unsupported voice telephony provider '${providerName}'. Supported providers: twilio, exotel, knowlarity, simulator`,
      );
    }
    return provider;
  }

  getAllProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

