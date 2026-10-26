import { ImportErrorPolicy, ImportMode } from "@billing/shared-types";

export class ConfirmImportDto {
  jobId!: string;
  module!: string;
  mapping!: Record<string, string>;
  mode?: ImportMode;
  errorPolicy?: ImportErrorPolicy;
}
