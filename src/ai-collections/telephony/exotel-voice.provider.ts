import { Injectable, Logger } from "@nestjs/common";
import {
  IVoiceProvider,
  InitiateCallParams,
  InitiateCallResult,
  WebhookCallEvent,
} from "./voice-provider.interface";
import { CredentialCryptoService } from "../security/credential-crypto.service";

@Injectable()
export class ExotelVoiceProvider implements IVoiceProvider {
  readonly name = "exotel";
  private readonly logger = new Logger(ExotelVoiceProvider.name);

  constructor(private readonly crypto: CredentialCryptoService) {}

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const accountSid =
      params.credentials.accountSid || process.env.EXOTEL_ACCOUNT_SID;
    const apiKey = params.credentials.apiKey || process.env.EXOTEL_API_KEY;
    const apiToken =
      params.credentials.apiSecret || process.env.EXOTEL_API_TOKEN;
    const callerId =
      params.credentials.virtualNumber || process.env.EXOTEL_CALLER_ID;

    if (!accountSid || !apiKey || !apiToken || !callerId) {
      throw new Error(
        "Exotel credentials (Account SID, API Key, API Token, Caller ID) are not configured.",
      );
    }

    let toNumber = params.customerPhone.trim().replace(/[\s\-()]/g, "");
    if (toNumber.startsWith("+91")) {
      toNumber = toNumber.substring(3);
    } else if (toNumber.startsWith("91") && toNumber.length === 12) {
      toNumber = toNumber.substring(2);
    }

    const authHeader = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
    const exotelEndpoint = `https://api.exotel.com/v1/Accounts/${accountSid}/Calls/connect.json`;

    const bodyParams = new URLSearchParams();
    bodyParams.append("From", callerId);
    bodyParams.append("To", toNumber);
    bodyParams.append("CallerId", callerId);
    bodyParams.append("StatusCallback", params.callbackUrl);
    bodyParams.append("CustomField", params.callId);

    try {
      const response = await fetch(exotelEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyParams.toString(),
      });

      const responseText = await response.text();
      let responseJson: any;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        responseJson = { raw: responseText };
      }

      if (!response.ok) {
        this.logger.error(
          `Exotel call initiation failed: ${response.status} ${responseText}`,
        );
        return {
          success: false,
          providerCallSid: "",
          provider: this.name,
          status: "FAILED",
          message:
            responseJson.RestException?.Message ||
            `Exotel call failed (${response.status})`,
          rawResponse: responseJson,
        };
      }

      const callSid = responseJson.Call?.Sid || "";
      return {
        success: true,
        providerCallSid: callSid,
        provider: this.name,
        status: responseJson.Call?.Status || "in-progress",
        message: "Call initiated successfully via Exotel",
        rawResponse: responseJson,
      };
    } catch (err: any) {
      this.logger.error(`Error connecting to Exotel API: ${err.message}`);
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
      payload.Status ||
      payload.CallStatus ||
      payload.status ||
      ""
    ).toLowerCase();
    let eventType: WebhookCallEvent["eventType"] = "IN_PROGRESS";

    if (payload.SpeechResult || payload.RecordingText) {
      eventType = "SPEECH_RESULT";
    } else if (rawStatus === "initiated" || rawStatus === "queued") {
      eventType = "INITIATED";
    } else if (rawStatus === "ringing") {
      eventType = "RINGING";
    } else if (rawStatus === "in-progress" || rawStatus === "connected") {
      eventType = "ANSWERED";
    } else if (rawStatus === "completed") {
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
      providerCallSid: payload.CallSid || payload.Sid || "",
      callId: payload.CustomField || payload.callId,
      eventType,
      speechResult: payload.SpeechResult || payload.RecordingText || undefined,
      durationSeconds: payload.Duration
        ? parseInt(payload.Duration, 10)
        : payload.CallDuration
          ? parseInt(payload.CallDuration, 10)
          : undefined,
      recordingUrl: payload.RecordingUrl || undefined,
      rawPayload: payload,
    };
  }
}

