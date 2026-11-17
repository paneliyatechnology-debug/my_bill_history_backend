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
export class TwilioVoiceProvider implements IVoiceProvider {
  readonly name = "twilio";
  private readonly logger = new Logger(TwilioVoiceProvider.name);

  constructor(private readonly crypto: CredentialCryptoService) {}

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const accountSid = (
      params.credentials.accountSid ||
      process.env.TWILIO_ACCOUNT_SID ||
      ""
    ).trim();
    const apiKey = (
      params.credentials.apiKey ||
      process.env.TWILIO_API_KEY_SID ||
      ""
    ).trim();
    const apiSecret = (
      params.credentials.apiSecret ||
      process.env.TWILIO_API_KEY_SECRET ||
      process.env.TWILIO_AUTH_TOKEN ||
      ""
    ).trim();
    const fromNumber = (
      params.credentials.virtualNumber ||
      process.env.TWILIO_PHONE_NUMBER ||
      ""
    ).trim();

    if (!accountSid) {
      throw new Error(
        "Twilio Account SID is missing. Please configure TWILIO_ACCOUNT_SID or save it in AI Collections Settings.",
      );
    }

    if (!apiSecret) {
      throw new Error(
        "Twilio Auth Secret / Token is missing. Please configure TWILIO_API_KEY_SECRET / TWILIO_AUTH_TOKEN or save it in AI Collections Settings.",
      );
    }

    if (!fromNumber) {
      throw new Error(
        "Twilio Virtual Phone Number is missing. Please configure TWILIO_PHONE_NUMBER or save it in AI Collections Settings.",
      );
    }

    // Standardize destination phone number for India (+91)
    let toNumber = params.customerPhone.trim().replace(/[\s\-()]/g, "");
    if (!toNumber.startsWith("+")) {
      if (toNumber.length === 10) {
        toNumber = `+91${toNumber}`;
      } else if (toNumber.startsWith("91") && toNumber.length === 12) {
        toNumber = `+${toNumber}`;
      } else {
        toNumber = `+91${toNumber}`;
      }
    }

    // Determine auth header: Use primary Auth Token if available, or API Key SID (SK...), or Account SID
    const envAuthToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    let authUser = accountSid;
    let authPass = apiSecret;
    if (envAuthToken) {
      authUser = accountSid;
      authPass = envAuthToken;
    } else if (apiKey && apiKey.startsWith("SK")) {
      authUser = apiKey;
      authPass = apiSecret;
    }
    const authHeader = Buffer.from(`${authUser}:${authPass}`).toString("base64");
    const twilioEndpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

    const bodyParams = new URLSearchParams();
    bodyParams.append("To", toNumber);
    bodyParams.append("From", fromNumber);
    bodyParams.append("Url", params.actionUrl);
    bodyParams.append("StatusCallback", params.callbackUrl);
    bodyParams.append(
      "StatusCallbackEvent",
      "initiated ringing answered completed",
    );
    bodyParams.append("StatusCallbackMethod", "POST");
    bodyParams.append("Record", "true"); // Optional call recording
    bodyParams.append("Timeout", "45");

    try {
      const response = await fetch(twilioEndpoint, {
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
          `Twilio call initiation failed: ${response.status} ${responseText}`,
        );
        return {
          success: false,
          providerCallSid: "",
          provider: this.name,
          status: "FAILED",
          message:
            responseJson.message || `Twilio call failed (${response.status})`,
          rawResponse: responseJson,
        };
      }

      return {
        success: true,
        providerCallSid: responseJson.sid,
        provider: this.name,
        status: responseJson.status || "queued",
        message: "Call initiated successfully via Twilio",
        rawResponse: responseJson,
      };
    } catch (err: any) {
      this.logger.error(`Error connecting to Twilio API: ${err.message}`);
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
    url: string,
    payload: any,
    secret: string,
  ): boolean {
    if (!signature || !secret) {
      return false;
    }
    return this.crypto.verifyTwilioSignature(signature, secret, url, payload);
  }

  parseWebhookEvent(
    payload: any,
    _headers?: Record<string, string>,
  ): WebhookCallEvent {
    const rawStatus = (payload.CallStatus || payload.status || "").toLowerCase();
    let eventType: WebhookCallEvent["eventType"] = "IN_PROGRESS";

    if (payload.SpeechResult) {
      eventType = "SPEECH_RESULT";
    } else if (rawStatus === "initiated" || rawStatus === "queued") {
      eventType = "INITIATED";
    } else if (rawStatus === "ringing") {
      eventType = "RINGING";
    } else if (rawStatus === "in-progress" || rawStatus === "answered") {
      eventType = "ANSWERED";
    } else if (rawStatus === "completed") {
      eventType = "COMPLETED";
    } else if (rawStatus === "busy") {
      eventType = "BUSY";
    } else if (rawStatus === "no-answer") {
      eventType = "NO_ANSWER";
    } else if (rawStatus === "canceled") {
      eventType = "CANCELED";
    } else if (rawStatus === "failed") {
      eventType = "FAILED";
    }

    return {
      provider: this.name,
      providerCallSid: payload.CallSid || payload.Sid || "",
      callId: payload.callId || payload.CallId,
      eventType,
      speechResult: payload.SpeechResult || undefined,
      confidence: payload.Confidence ? parseFloat(payload.Confidence) : undefined,
      durationSeconds: payload.CallDuration
        ? parseInt(payload.CallDuration, 10)
        : payload.Duration
          ? parseInt(payload.Duration, 10)
          : undefined,
      recordingUrl: payload.RecordingUrl || undefined,
      recordingDuration: payload.RecordingDuration
        ? parseInt(payload.RecordingDuration, 10)
        : undefined,
      rawPayload: payload,
    };
  }

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<ConnectionTestResult> {
    const timestamp = new Date().toISOString();
    const accountSid = (
      credentials.accountSid ||
      process.env.TWILIO_ACCOUNT_SID ||
      ""
    ).trim();
    const apiKey = (
      credentials.apiKey ||
      process.env.TWILIO_API_KEY_SID ||
      ""
    ).trim();
    const apiSecret = (
      credentials.apiSecret ||
      process.env.TWILIO_API_KEY_SECRET ||
      process.env.TWILIO_AUTH_TOKEN ||
      ""
    ).trim();
    const virtualNumber = (
      credentials.virtualNumber ||
      process.env.TWILIO_PHONE_NUMBER ||
      ""
    ).trim();
    const publicUrl = (process.env.PUBLIC_API_URL || "").trim();

    // 1. Account SID format validation
    if (!accountSid) {
      return {
        success: false,
        provider: this.name,
        message:
          "Twilio Account SID is missing. Please provide your Account SID (starts with AC).",
        timestamp,
      };
    }

    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
      return {
        success: false,
        provider: this.name,
        accountSid,
        message: `Invalid Twilio Account SID format: "${accountSid.slice(0, 4)}...". Account SID must start with 'AC' followed by 32 hexadecimal characters.`,
        timestamp,
      };
    }

    // 2. API Key / Secret format validation
    if (!apiSecret) {
      return {
        success: false,
        provider: this.name,
        accountSid,
        message:
          "Twilio Secret or Auth Token is missing. Please configure TWILIO_API_KEY_SECRET / TWILIO_AUTH_TOKEN.",
        timestamp,
      };
    }

    let authUser = accountSid;
    if (apiKey) {
      if (!/^SK[0-9a-fA-F]{32}$/.test(apiKey)) {
        return {
          success: false,
          provider: this.name,
          accountSid,
          message: `Invalid Twilio API Key SID format: "${apiKey.slice(0, 4)}...". API Key SID must start with 'SK' followed by 32 hexadecimal characters.`,
          timestamp,
        };
      }
      authUser = apiKey;
    }

    // 3. API Key Secret / Auth Token Authentication against Twilio REST API
    let authHeader = Buffer.from(`${authUser}:${apiSecret}`).toString("base64");
    let accountData: any = null;

    try {
      let res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
        {
          headers: { Authorization: `Basic ${authHeader}` },
        },
      );

      let text = await res.text();
      try {
        accountData = JSON.parse(text);
      } catch {
        accountData = { message: text };
      }

      // If API key returned 401 code 70051, attempt primary Auth Token fallback if configured
      if (!res.ok && accountData.code === 70051) {
        const envToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
        if (envToken && authUser !== accountSid) {
          const fallbackAuth = Buffer.from(`${accountSid}:${envToken}`).toString("base64");
          const fallbackRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
            { headers: { Authorization: `Basic ${fallbackAuth}` } },
          );
          if (fallbackRes.ok) {
            accountData = await fallbackRes.json();
            authHeader = fallbackAuth;
            res = fallbackRes;
          }
        }
      }

      if (!res.ok) {
        if (accountData.code === 70051) {
          return {
            success: false,
            provider: this.name,
            accountSid,
            message:
              "Twilio authorization failed (code 70051: The authorization with Key failed). Please ensure you have checked the 'Got it!' box and clicked the blue 'Finish' button in Twilio Console (Create API key wizard) to activate this key. Alternatively, your Twilio Account SID and Auth Token can be used directly.",
            details: accountData,
            timestamp,
          };
        }
        return {
          success: false,
          provider: this.name,
          accountSid,
          message:
            accountData.message ||
            `Twilio authentication failed with HTTP ${res.status}.`,
          details: accountData,
          timestamp,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        provider: this.name,
        accountSid,
        message: `Network error connecting to Twilio API: ${err.message}`,
        timestamp,
      };
    }

    // 4. Check available phone numbers and voice capability
    let availableNumbers: Array<{
      phoneNumber: string;
      friendlyName?: string;
      voice: boolean;
      sms: boolean;
    }> = [];

    try {
      const numRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`,
        {
          headers: { Authorization: `Basic ${authHeader}` },
        },
      );
      if (numRes.ok) {
        const numData = await numRes.json();
        availableNumbers = (numData.incoming_phone_numbers || []).map((n: any) => ({
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name,
          voice: !!n.capabilities?.voice,
          sms: !!n.capabilities?.SMS || !!n.capabilities?.sms,
        }));
      }
    } catch (e: any) {
      this.logger.warn(`Could not fetch Twilio phone numbers: ${e.message}`);
    }

    // 5. Check verified caller IDs (required for outbound calls on Trial accounts)
    let verifiedCallerIds: string[] = [];
    try {
      const callerRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/OutgoingCallerIds.json`,
        {
          headers: { Authorization: `Basic ${authHeader}` },
        },
      );
      if (callerRes.ok) {
        const callerData = await callerRes.json();
        verifiedCallerIds = (callerData.outgoing_caller_ids || []).map(
          (c: any) => c.phone_number,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Could not fetch verified caller IDs: ${e.message}`);
    }

    // 6. Configured Virtual Number check
    const configuredNumberVoiceCapable = availableNumbers.some(
      (n) => n.phoneNumber === virtualNumber && n.voice,
    );

    // 7. Check Public Webhook URL
    const isHttps = publicUrl.startsWith("https://");
    const publicApiUrlStatus = {
      configured: !!publicUrl,
      isHttps,
      url: publicUrl || undefined,
      recommendation: !publicUrl
        ? "PUBLIC_API_URL is missing. Live voice calling requires a public HTTPS URL (e.g. ngrok or cloudflared) so Twilio can deliver speech recognition and call status webhooks."
        : !isHttps
        ? "PUBLIC_API_URL must start with https:// for Twilio webhooks."
        : "Valid HTTPS public webhook URL.",
    };

    const isTrial = (accountData.type || "").toLowerCase() === "trial";

    return {
      success: true,
      provider: this.name,
      accountSid: accountData.sid || accountSid,
      accountName: accountData.friendly_name,
      accountStatus: accountData.status,
      accountType: accountData.type,
      trialRestrictions: isTrial,
      availableNumbers,
      configuredNumber: virtualNumber || undefined,
      configuredNumberVoiceCapable,
      verifiedCallerIds,
      geoPermissionsNotes:
        "International outbound calls to India (+91) require Geo Permissions enabled under Voice > Settings > Geo Permissions in your Twilio Console.",
      publicApiUrlStatus,
      message: `Twilio Account [${accountData.friendly_name || accountSid}] authenticated successfully. Status: ${accountData.status}, Type: ${accountData.type}. Phone numbers: ${availableNumbers.length}. Verified Caller IDs: ${verifiedCallerIds.length}.`,
      timestamp,
    };
  }

  generateSpeechResponse(options: {
    speechText: string;
    isFinalTurn?: boolean;
    language: string;
    callId: string;
    actionUrl: string;
  }): string {
    const escaped = options.speechText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    // Twilio speech recognition language codes
    let speechLang = "gu-IN";
    let voice = "Polly.Aditi";
    let reprompt = "માફ કરશો, તમારો અવાજ સંભળાયો નથી. કૃપા કરીને ફરી બોલો.";

    if (options.language.toLowerCase().includes("hin")) {
      speechLang = "hi-IN";
      voice = "Polly.Aditi";
      reprompt = "माफ़ कीजिये, आपकी आवाज़ सुनाई नहीं दी। क्या आप बता सकते हैं कि आप पेमेंट कब तक कर पाएंगे?";
    } else if (options.language.toLowerCase().includes("eng")) {
      speechLang = "en-IN";
      voice = "Polly.Aditi";
      reprompt = "Sorry, I could not hear your response. Could you please let us know when you will be able to make the payment?";
    }

    if (options.isFinalTurn) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say language="${speechLang}" voice="${voice}">${escaped}</Say>
    <Pause length="1"/>
    <Hangup/>
</Response>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="${options.actionUrl}?callId=${options.callId}" language="${speechLang}" speechTimeout="auto" timeout="6">
        <Say language="${speechLang}" voice="${voice}">${escaped}</Say>
    </Gather>
    <Say language="${speechLang}" voice="${voice}">${reprompt}</Say>
    <Redirect>${options.actionUrl}?callId=${options.callId}&amp;retry=1</Redirect>
</Response>`;
  }
}

