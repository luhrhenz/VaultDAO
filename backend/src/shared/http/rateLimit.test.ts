import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimitMiddleware } from "./rateLimit.js";
import express, { Request, Response } from "express";

test("Rate Limiter", async (t) => {
  await t.test("allows requests within limit", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 3,
    });

    const app = express();
    let callCount = 0;
    app.use(middleware);
    app.get("/", (_req, res) => {
      callCount++;
      res.json({ ok: true });
    });

    // Simulate 3 requests within limit
    const mockReq = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      get: () => undefined,
    } as unknown as Request;
    const mockRes = {
      set: () => mockRes,
      json: () => {},
      status: () => mockRes,
    } as unknown as Response;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    middleware(mockReq, mockRes, next);
    middleware(mockReq, mockRes, next);
    middleware(mockReq, mockRes, next);

    assert.equal(nextCalled, 3, "First 3 requests should be allowed");
  });

  await t.test("blocks requests exceeding limit", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 2,
    });

    const mockReq = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      get: () => undefined,
    } as unknown as Request;

    const mockRes = {
      status: function (code: number): any {
        this.statusCode = code;
        return this;
      },
      set: (): any => mockRes,
      json: function (data: any): any {
        this.jsonData = data;
        return this;
      },
      statusCode: 0,
      jsonData: null,
    } as any;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    // First two requests allowed
    middleware(mockReq, mockRes, next);
    middleware(mockReq, mockRes, next);

    // Third request blocked
    middleware(mockReq, mockRes, next);

    assert.equal(
      (mockRes as any).statusCode,
      429,
      "Should return 429 for exceeded limit"
    );
    assert.equal(
      (mockRes as any).jsonData?.error?.code,
      "RATE_LIMIT_EXCEEDED"
    );
    assert.equal(nextCalled, 2, "Only first 2 requests should call next");
  });

  await t.test("resets limit after window expires", async () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 100, // 100ms window
      maxRequests: 1,
    });

    const mockReq = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      get: () => undefined,
    } as unknown as Request;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    const mockRes = {
      status: function () {
        return this;
      },
      set: () => mockRes,
      json: () => {},
    } as unknown as Response;

    // First request allowed
    middleware(mockReq, mockRes, next);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be allowed again
    middleware(mockReq, mockRes, next);

    assert.equal(nextCalled, 2, "Should allow requests after window expires");
  });

  await t.test("sets X-RateLimit headers on allowed requests", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 5,
    });

    const mockReq = {
      headers: {},
      socket: { remoteAddress: "10.0.0.1" },
      get: () => undefined,
    } as unknown as Request;

    const headers: Record<string, string> = {};
    const mockRes = {
      set: (h: Record<string, string>) => { Object.assign(headers, h); return mockRes; },
      status: () => mockRes,
      json: () => mockRes,
    } as unknown as Response;

    middleware(mockReq, mockRes, () => {});

    assert.equal(headers["X-RateLimit-Limit"], "5");
    assert.equal(headers["X-RateLimit-Remaining"], "4");
    // Reset should be a Unix timestamp (numeric string, not ISO)
    assert.match(headers["X-RateLimit-Reset"], /^\d+$/, "X-RateLimit-Reset should be a Unix timestamp");
    const reset = Number(headers["X-RateLimit-Reset"]);
    assert.ok(reset > Date.now() / 1000, "Reset timestamp should be in the future");
  });

  await t.test("sets X-RateLimit headers on 429 responses", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 1,
    });

    const mockReq = {
      headers: {},
      socket: { remoteAddress: "10.0.0.2" },
      get: () => undefined,
    } as unknown as Request;

    const headers: Record<string, string> = {};
    const mockRes = {
      set: (h: Record<string, string>) => { Object.assign(headers, h); return mockRes; },
      status: () => mockRes,
      json: () => mockRes,
    } as unknown as Response;

    middleware(mockReq, mockRes, () => {});
    middleware(mockReq, mockRes, () => {}); // triggers 429

    assert.equal(headers["X-RateLimit-Limit"], "1");
    assert.equal(headers["X-RateLimit-Remaining"], "0");
    assert.match(headers["X-RateLimit-Reset"], /^\d+$/, "X-RateLimit-Reset should be a Unix timestamp on 429");
    assert.ok(headers["Retry-After"], "Retry-After should be set on 429");
  });

  await t.test("identifies clients by IP address", () => {
    const middleware = createRateLimitMiddleware({
      windowMs: 1000,
      maxRequests: 1,
    });

    const createMockReq = (ip: string) => ({
      headers: {},
      socket: { remoteAddress: ip },
      get: () => undefined,
    }) as unknown as Request;

    let nextCalled = 0;
    const next = () => {
      nextCalled++;
    };

    const mockRes = {
      status: function () {
        return this;
      },
      set: () => mockRes,
      json: () => {},
    } as unknown as Response;

    const req1 = createMockReq("192.168.1.1");
    const req2 = createMockReq("192.168.1.2");

    // First client hits limit
    middleware(req1, mockRes, next);

    // Second client should not be limited
    middleware(req2, mockRes, next);

    assert.equal(
      nextCalled,
      2,
      "Different IPs should have separate rate limits"
    );
  });
});
