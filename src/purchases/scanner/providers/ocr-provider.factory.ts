import { Injectable, Logger } from "@nestjs/common";
import { IOcrProvider } from "./ocr-provider.interface";
import { MockOcrProvider } from "./mock-ocr.provider";
import { GeminiOcrProvider } from "./gemini-ocr.provider";
import { LocalDocumentOcrProvider } from "./local-document-ocr.provider";

@Injectable()
export class OcrProviderFactory {
  private readonly logger = new Logger(OcrProviderFactory.name);
  private readonly providers = new Map<string, IOcrProvider>();

  constructor(
    private readonly mockProvider: MockOcrProvider,
    private readonly geminiProvider: GeminiOcrProvider,
    private readonly localProvider: LocalDocumentOcrProvider,
  ) {
    this.providers.set(mockProvider.name, mockProvider);
    this.providers.set(geminiProvider.name, geminiProvider);
    this.providers.set(localProvider.name, localProvider);
  }

  getProvider(providerName?: string): IOcrProvider {
    const configuredName =
      providerName || process.env.OCR_PROVIDER || (this.geminiProvider.isAvailable() ? "gemini" : "local");

    const selected = this.providers.get(configuredName.toLowerCase());
    if (selected) {
      if (selected.name === "mock" && process.env.NODE_ENV !== "test") {
        this.logger.warn("Mock OCR provider is forbidden outside of test environment. Falling back to local OCR provider.");
        return this.localProvider;
      }
      if (selected.name === "gemini" && !selected.isAvailable()) {
        this.logger.warn("Gemini OCR requested but GEMINI_API_KEY is not available. Falling back to local OCR provider.");
        return this.localProvider;
      }
      return selected;
    }

    this.logger.warn(`OCR Provider '${providerName}' not recognized. Falling back to local OCR provider.`);
    return this.localProvider;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
