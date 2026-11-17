import { Injectable, Logger } from "@nestjs/common";
import {
  IVoiceProvider,
  InitiateCallParams,
  InitiateCallResult,
  WebhookCallEvent,
} from "./voice-provider.interface";
import { CredentialCryptoService } from "../security/credential-crypto.service";

@Injectable()
export class KnowlarityVoiceProvider implements IVoiceProvider {
  readonly name = "knowlarity";
  private readonly logger = new Logger(KnowlarityVoiceProvider.name);

  constructor(private readonly crypto: CredentialCryptoService) {}

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const apiKey = params.credentials.apiKey || process.env.KNOWLARITY_API_KEY;
    const channelNo =
      params.credentials.virtualNumber ||
      process.env.KNOWLARITY_CHANNEL_NUMBER;
    const authorization =
      params.credentials.apiSecret || process.env.KNOWLARITY_AUTH_TOKEN;

    if (!apiKey || !channelNo) {
      throw new Error(
        "Knowlarity credentials (API Key, Virtual Channel Number) are not configured.",
      );
    }

    let toNumber = params.customerPhone.trim().replace(/[\s\-()]/g, "");
    if (!toNumber.startsWith("+91")) {
      if (toNumber.length === 10) {
        toNumber = `+91${toNumber}`;
      }
    }

    const knowlarityEndpoint =
      "https://kpi.knowlarity.com/vr/service/index.php";
    const bodyParams = {
      action: "makecall",
      api_key: apiKey,
      customer_number: toNumber,
      k_number: channelNo,
      callback_url: params.callbackUrl,
    };

    try {
      const response = await fetch(knowlarityEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization || "",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(bodyParams),
      });

      const responseText = await response.text();
      let responseJson: any;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        responseJson = { raw: responseText };
      }

      if (!response.ok) {
        return {
          success: false,
          providerCallSid: "",
          provider: this.name,
          status: "FAILED",
          message:
            responseJson.message || `Knowlarity call failed (${response.status})`,
          rawResponse: responseJson,
        };
      }

      const callSid =
        responseJson.call_id || responseJson.uuid || `know_${Date.now()}`;
      return {
        success: true,
        providerCallSid: callSid,
        provider: this.name,
        status: "initiated",
        message: "Call initiated successfully via Knowlarity",
        rawResponse: responseJson,
      };
    } catch (err: any) {
      this.logger.error(`Error connecting to Knowlarity API: ${err.message}`);
      return {
        success: false,
        providerCallSid: "",
        provider: this.name,
        status: "FAILED",
        message: err.message,
      };
    }
  }

  verifyWebhook(
    signature: string,
    _url: string,
    _payload: any,
    secret: string,
  ): boolean {
    if (!signature || !secret) {
      return false;
    }
    return this.crypto.verifyWebhookToken(signature, secret);
  }

  parseWebhookEvent(
    payload: any,
    _headers?: Record<string, string>,
  ): WebhookCallEvent {
    const rawStatus = (
      payload.status ||
      payload.call_status ||
      ""
    ).toLowerCase();
    let eventType: WebhookCallEvent["eventType"] = "IN_PROGRESS";

    if (payload.speech_text || payload.speechResult) {
      eventType = "SPEECH_RESULT";
    } else if (rawStatus === "initiated" || rawStatus === "originated") {
      eventType = "INITIATED";
    } else if (rawStatus === "ringing") {
      eventType = "RINGING";
    } else if (rawStatus === "answered" || rawStatus === "connected") {
      eventType = "ANSWERED";
    } else if (rawStatus === "completed" || rawStatus === "success") {
      eventType = "COMPLETED";
    } else if (rawStatus === "busy") {
      eventType = "BUSY";
    } else if (rawStatus === "no-answer") {
      eventType = "NO_ANSWER";
    } else if (rawStatus === "failed") {
      eventType = "FAILED";
    }

    return {
      provider: this.name,
      providerCallSid: payload.call_id || payload.uuid || payload.CallSid || "",
      callId: payload.callId || payload.custom_id,
      eventType,
      speechResult: payload.speech_text || payload.speechResult || undefined,
      durationSeconds: payload.duration ? parseInt(payload.duration, 10) : undefined,
      recordingUrl: payload.recording_url || undefined,
      rawPayload: payload,
    };
  }
}

