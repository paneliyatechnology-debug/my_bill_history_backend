import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HealthController } from "../src/health/health.controller";
import { DatabaseService } from "../src/database/database.service";

describe("HealthController & Probes", () => {
  let db: DatabaseService;
  let controller: HealthController;

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();
    controller = new HealthController(db);
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it("should return base health status ok", () => {
    const result = controller.getHealth();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("billing-api");
    expect(result.version).toBe("0.1.0");
    expect(result.timestamp).toBeDefined();
    expect(typeof result.uptime).toBe("number");
  });

  it("should return liveness probe status ok", () => {
    const result = controller.getLiveness();
    expect(result.status).toBe("ok");
    expect(typeof result.uptime).toBe("number");
    expect(result.timestamp).toBeDefined();
  });

  it("should return readiness probe status ok with database connectivity", async () => {
    const result = await controller.getReadiness();
    expect(result.status).toBe("ok");
    expect(result.database).toBe("connected");
    expect(result.timestamp).toBeDefined();
  });
});
