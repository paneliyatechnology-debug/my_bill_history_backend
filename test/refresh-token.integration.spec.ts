import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Refresh Token API Flow Integration Tests", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  const testUserPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
  const testUserEmail = `refreshtest_${Date.now()}@example.com`;
  const testPassword = "Password123#";

  let initialAccessToken: string;
  let initialRefreshToken: string;
  let testUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );

    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(DatabaseService);

    // 1. Register a fresh user
    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Refresh Token Tester",
        phone: testUserPhone,
        email: testUserEmail,
        password: testPassword,
        organizationName: "Refresh Testing Enterprise",
        tradeName: "Refresh Enterprise GJ",
        stateCode: "24",
      },
    });

    if (regRes.statusCode !== 201) {
      console.error("Register failed in beforeAll:", regRes.body);
    }

    expect(regRes.statusCode).toBe(201);
    const regBody = JSON.parse(regRes.body);
    expect(regBody.accessToken).toBeDefined();
    expect(regBody.refreshToken).toBeDefined();
    expect(regBody.tokenType).toBe("Bearer");
    expect(regBody.expiresIn).toBe(86400);
    expect(regBody.refreshTokenExpiresIn).toBe(604800);

    testUserId = regBody.user.id;
  });

  afterAll(async () => {
    try {
      await prisma.executeBypassRls(async (tx) => {
        if (testUserId) {
          const user = await tx.user.findUnique({ where: { id: testUserId } });
          if (user) {
            const orgId = user.organizationId;
            await tx.auditLog.deleteMany({ where: { organizationId: orgId } });
            await tx.userBranchAssignment.deleteMany({ where: { branch: { organizationId: orgId } } });
            await tx.user.deleteMany({ where: { organizationId: orgId } });
            await tx.branch.deleteMany({ where: { organizationId: orgId } });
            await tx.company.deleteMany({ where: { organizationId: orgId } });
            await tx.organization.deleteMany({ where: { id: orgId } });
          }
        }
      });
    } catch (e) {
      // Ignore cleanup error in test
    }
    await app.close();
  });

  it("1. POST /api/v1/auth/login returns both accessToken and refreshToken", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        identifier: testUserPhone,
        password: testPassword,
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = JSON.parse(loginRes.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.tokenType).toBe("Bearer");
    expect(body.expiresIn).toBe(86400);
    expect(body.refreshTokenExpiresIn).toBe(604800);

    initialAccessToken = body.accessToken;
    initialRefreshToken = body.refreshToken;
  });

  it("2. POST /api/v1/auth/refresh-token successfully generates a new accessToken and rotates refreshToken", async () => {
    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: {
        refreshToken: initialRefreshToken,
      },
    });

    expect(refreshRes.statusCode).toBe(200);
    const body = JSON.parse(refreshRes.body);

    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.tokenType).toBe("Bearer");
    expect(body.expiresIn).toBe(86400);
    expect(body.refreshTokenExpiresIn).toBe(604800);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(testUserEmail);
    expect(body.defaultContext).toBeDefined();

    // Verify the new access token works against protected endpoint /auth/me
    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${body.accessToken}`,
      },
    });
    expect(meRes.statusCode).toBe(200);
    const meBody = JSON.parse(meRes.body);
    expect(meBody.user.email).toBe(testUserEmail);

    // Save the rotated token for next tests
    initialRefreshToken = body.refreshToken;
  });

  it("3. POST /api/v1/auth/refresh alias endpoint works identically", async () => {
    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: {
        refreshToken: initialRefreshToken,
      },
    });

    expect(refreshRes.statusCode).toBe(200);
    const body = JSON.parse(refreshRes.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();

    initialRefreshToken = body.refreshToken;
  });

  it("4. Supports Bearer header authorization for refresh endpoint", async () => {
    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      headers: {
        authorization: `Bearer ${initialRefreshToken}`,
      },
      payload: {},
    });

    expect(refreshRes.statusCode).toBe(200);
    const body = JSON.parse(refreshRes.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();

    initialRefreshToken = body.refreshToken;
  });

  it("5. Rejects missing refresh token with 400 Bad Request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("Refresh token is required");
  });

  it("6. Rejects malformed / invalid refresh token with 401 Unauthorized", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: {
        refreshToken: "invalid.token.payload-signature",
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("Invalid or expired refresh token");
  });

  it("7. Refresh token cannot be used directly as an access token on protected endpoints", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${initialRefreshToken}`,
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.statusCode).toBe(401);
  });

  it("8. Rejects refresh request when user account is deactivated (403 Forbidden)", async () => {
    // Temporarily deactivate the user
    await prisma.executeBypassRls(async (tx) => {
      await tx.user.update({
        where: { id: testUserId },
        data: { isActive: false },
      });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh-token",
      payload: {
        refreshToken: initialRefreshToken,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("deactivated");

    // Reactivate user
    await prisma.executeBypassRls(async (tx) => {
      await tx.user.update({
        where: { id: testUserId },
        data: { isActive: true },
      });
    });
  });
});
