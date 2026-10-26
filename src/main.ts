import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const isProd = process.env.NODE_ENV === "production";

  // 1. Startup Production Secrets Validation
  if (isProd) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.length < 32) {
      logger.error(
        "FATAL STARTUP BLOCKED: JWT_SECRET must be set and at least 32 characters in production.",
      );
      process.exit(1);
    }
    if (!process.env.DATABASE_URL) {
      logger.error("FATAL STARTUP BLOCKED: DATABASE_URL must be configured.");
      process.exit(1);
    }
  }

  // 2. Safe Trust Proxy Configuration
  // In production, do not trust arbitrary public proxies unless explicitly configured via TRUST_PROXY
  let trustProxy: boolean | string | string[] = true;
  if (process.env.TRUST_PROXY) {
    const rawTrust = process.env.TRUST_PROXY.trim();
    if (rawTrust === "false") {
      trustProxy = false;
    } else if (rawTrust === "true") {
      trustProxy = true;
    } else if (rawTrust.includes(",")) {
      trustProxy = rawTrust.split(",").map((s) => s.trim());
    } else {
      trustProxy = rawTrust;
    }
  } else if (isProd) {
    // In production without explicit TRUST_PROXY, default to loopback to prevent header spoofing
    trustProxy = "127.0.0.1";
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      trustProxy,
      bodyLimit: 25 * 1024 * 1024, // 25 MB max payload
    }),
  );

  // Register multipart support for bill uploads (15MB limit)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  await app.register(require("@fastify/multipart"), {
    limits: {
      fileSize: 15 * 1024 * 1024,
    },
  });

  // 3. Graceful Shutdown Hooks
  app.enableShutdownHooks();

  app.setGlobalPrefix("api/v1");

  const rawEnvOrigins = process.env.CORS_ORIGIN || process.env.FRONTEND_URL;
  const configuredOrigins = rawEnvOrigins
    ? rawEnvOrigins.split(",").map((s) => s.trim().toLowerCase().replace(/\/$/, ""))
    : [];

  const isOriginAllowed = (origin: string): boolean => {
    const cleanOrigin = origin.toLowerCase().trim().replace(/\/$/, "");

    // 1. Explicitly configured origins or wildcard in environment
    if (configuredOrigins.includes("*") || configuredOrigins.includes(cleanOrigin)) {
      return true;
    }

    // 2. Production domain and all subdomains (e.g. https://myownbillbook.com, https://www.myownbillbook.com)
    if (/^https?:\/\/([a-zA-Z0-9-]+\.)*myownbillbook\.com$/.test(cleanOrigin)) {
      return true;
    }

    // 3. Vercel deployments (production and preview branches)
    if (/^https?:\/\/([a-zA-Z0-9-]+\.)*vercel\.app$/.test(cleanOrigin)) {
      return true;
    }

    // 4. Render deployment domains
    if (/^https?:\/\/([a-zA-Z0-9-]+\.)*onrender\.com$/.test(cleanOrigin)) {
      return true;
    }

    // 5. Localhost and loopback development/testing origins
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin)) {
      return true;
    }

    // 6. In non-production environments, allow all origins
    if (!isProd) {
      return true;
    }

    return false;
  };

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no Origin header (e.g. mobile apps, curl, server-to-server)
      if (!origin || isOriginAllowed(origin)) {
        return callback(null, true);
      }

      logger.warn(`Blocked CORS request from disallowed origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Origin",
      "X-Requested-With",
      "x-organization-id",
      "x-company-id",
      "x-branch-id",
      "x-financial-year-id",
      "idempotency-key",
      "x-idempotency-key",
    ],
    exposedHeaders: ["x-correlation-id", "Content-Disposition"],
  });

  const port = process.env.PORT || 4000;
  await app.listen(port, "0.0.0.0");
  logger.log(`Billing API Gateway running on: http://localhost:${port}/api/v1`);
}

bootstrap();
