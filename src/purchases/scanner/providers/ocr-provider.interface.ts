import { ExtractedBillDataDto } from "../schemas/bill-extraction.schema";

export interface OcrOptions {
  fileName?: string;
  mimeType?: string;
  companyStateCode?: string;
  companyGstin?: string;
  companyName?: string;
}

export interface OcrResult {
  provider: string;
  extractedData: ExtractedBillDataDto;
  rawText?: string;
}

export interface IOcrProvider {
  readonly name: string;
  isAvailable(): boolean;
  extractInvoice(fileBuffer: Buffer, mimeType: string, options?: OcrOptions): Promise<OcrResult>;
}
