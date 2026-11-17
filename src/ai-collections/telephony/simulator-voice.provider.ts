import { Injectable, Logger } from "@nestjs/common";
import {
  IVoiceProvider,
  InitiateCallParams,
  InitiateCallResult,
  WebhookCallEvent,
  ProviderCredentials,
  ConnectionTestResult,
} from "./voice-provider.interface";
import { CredentialCryptoService } from "../security/credential-crypto.service";

@Injectable()
export class SimulatorVoiceProvider implements IVoiceProvider {
  readonly name = "simulator";
  private readonly logger = new Logger(SimulatorVoiceProvider.name);

  constructor(private readonly crypto: CredentialCryptoService) {}

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const mockSid = `sim_call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.logger.log(
      `[Voice Simulator] Initiating simulated live call ${mockSid} to ${params.customerName} (${params.customerPhone}) for ₹${params.outstandingAmount}`,
    );

    return {
      success: true,
      providerCallSid: mockSid,
      provider: this.name,
      status: "ringing",
      message: "Call initiated successfully in Sandbox / Telephony Bridge mode",
      rawResponse: {
        sid: mockSid,
        to: params.customerPhone,
        customerName: params.customerName,
        outstandingAmount: params.outstandingAmount,
        greeting: params.greetingText,
      },
    };
  }

  verifyWebhook(
    signature: string,
    _url: string,
    _payload: any,
    secret: string,
  ): boolean {
    if (!signature) return true; // Simulator allows testing with or without secret
    if (!secret) return true;
    return this.crypto.verifyWebhookToken(signature, secret);
  }

  parseWebhookEvent(
    payload: any,
    _headers?: Record<string, string>,
  ): WebhookCallEvent {
    const rawStatus = (payload.status || payload.eventType || "ANSWERED").toUpperCase();
    let eventType: WebhookCallEvent["eventType"] = "ANSWERED";

    if (payload.speechResult || payload.text || payload.SpeechResult) {
      eventType = "SPEECH_RESULT";
    } else if (rawStatus === "INITIATED") {
      eventType = "INITIATED";
    } else if (rawStatus === "RINGING") {
      eventType = "RINGING";
    } else if (rawStatus === "COMPLETED") {
      eventType = "COMPLETED";
    } else if (rawStatus === "BUSY") {
      eventType = "BUSY";
    } else if (rawStatus === "NO_ANSWER") {
      eventType = "NO_ANSWER";
    } else if (rawStatus === "FAILED") {
      eventType = "FAILED";
    }

    return {
      provider: this.name,
      providerCallSid:
        payload.providerCallSid || payload.callSid || `sim_${Date.now()}`,
      callId: payload.callId,
      eventType,
      speechResult: payload.speechResult || payload.text || payload.SpeechResult,
      confidence: payload.confidence || 0.98,
      durationSeconds: payload.durationSeconds || payload.duration || 45,
      recordingUrl:
        payload.recordingUrl ||
        "https://api.myownbillbook.com/storage/recordings/sample-collection-call.mp3",
      recordingDuration: payload.recordingDuration || 45,
      rawPayload: payload,
    };
  }

  async testConnection(
    _credentials?: ProviderCredentials,
  ): Promise<ConnectionTestResult> {
    return {
      success: true,
      provider: this.name,
      accountSid: "SIMULATOR_SANDBOX_TRUNK",
      accountName: "MyOwnBillBook Telephony Sandbox Bridge",
      accountStatus: "active",
      accountType: "Sandbox / Virtual Trunk",
      trialRestrictions: false,
      availableNumbers: [
        {
          phoneNumber: "+917900000000",
          friendlyName: "Virtual Test Trunk (India)",
          voice: true,
          sms: true,
        },
      ],
      configuredNumber: "+917900000000",
      configuredNumberVoiceCapable: true,
      verifiedCallerIds: ["+919999999999", "+919876543210"],
      publicApiUrlStatus: {
        configured: true,
        isHttps: true,
        url: "http://localhost:4000 (Internal Bridge)",
        recommendation:
          "Simulator operates locally without requiring public tunnel.",
      },
      message:
        "Telephony Sandbox Bridge is operational. Ready for testing calling workflows and speech engines.",
      timestamp: new Date().toISOString(),
    };
  }

  generateSpeechResponse(options: {
    speechText: string;
    isFinalTurn?: boolean;
    language: string;
    callId: string;
    actionUrl: string;
  }): string {
    return JSON.stringify({
      provider: "simulator",
      callId: options.callId,
      speechText: options.speechText,
      isFinalTurn: !!options.isFinalTurn,
      language: options.language,
      actionUrl: options.actionUrl,
    });
  }
}

