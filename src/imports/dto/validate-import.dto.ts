import { ImportMode } from "@billing/shared-types";

export class ValidateImportDto {
  jobId!: string;
  module!: string;
  mapping!: Record<string, string>;
  mode?: ImportMode;
}
