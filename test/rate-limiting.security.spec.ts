import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { Controller, Post, HttpCode, HttpStatus } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";

@Controller("test-throttle")
class TestThrottleController {
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login() {
    return { success: true };
  }
}

describe("Security Hardening: Rate Limiting & Throttler Verification", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            ttl: 60000,
            limit: 100,
          },
        ]),
      ],
      controllers: [TestThrottleController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should allow requests within throttle limit (limit = 3)", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/test-throttle/login",
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ success: true });
    }
  });

  it("should reject request with HTTP 429 Too Many Requests when limit exceeded", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/test-throttle/login",
    });
    expect(res.statusCode).toBe(429);
  });
});
