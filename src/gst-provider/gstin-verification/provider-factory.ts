import { AppyflowProvider } from "./appyflow.provider";
import { GstinCloudProvider } from "./gstin-cloud.provider";
import { GstinApiProvider } from "./gstinapi.provider";
import { MockGstVerificationProvider } from "./mock.provider";
import { GstinProviderConfig, IGstVerificationProvider } from "./types";

export type GstinProviderType =
  "gstin_cloud" | "gstincloud" | "appyflow" | "gstinapi" | "mock";

export class GstinProviderFactory {
  static create(
    providerType: string = "gstin_cloud",
    config: GstinProviderConfig = {},
  ): IGstVerificationProvider {
    const normalized = providerType.toLowerCase().replace(/[-_]/g, "");

    switch (normalized) {
      case "gstincloud":
        return new GstinCloudProvider(config);
      case "appyflow":
        return new AppyflowProvider(config);
      case "gstinapi":
        return new GstinApiProvider(config);
      case "mock":
        return new MockGstVerificationProvider();
      default:
        // Default to GSTIN.cloud
        return new GstinCloudProvider(config);
    }
  }
}
