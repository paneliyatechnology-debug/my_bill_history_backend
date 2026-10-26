import { PrismaClient, Prisma } from "@prisma/client";

export * from "@prisma/client";

/**
 * Instantiate and export standard Prisma client singleton factory
 */
export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient({
    datasources: databaseUrl
      ? {
          db: {
            url: databaseUrl,
          },
        }
      : undefined,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export { PrismaClient };
