import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@billing/database": path.resolve(__dirname, "./src/database/index.ts"),
      "@billing/shared-types": path.resolve(__dirname, "./src/shared-types/index.ts"),
      "@billing/accounting-core": path.resolve(__dirname, "./src/accounting-core/index.ts"),
      "@billing/gst-provider": path.resolve(__dirname, "./src/gst-provider/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 20000,
    env: {
      SKIP_EMAIL_OTP: "true",
    },
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
    }),
  ],
});
