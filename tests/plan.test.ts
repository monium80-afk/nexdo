/// <reference types="node" />
// Free vs Pro: the allowances themselves, how the server reads RevenueCat's
// answer about an account, and who gets asked at all.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { displayLimit, isPlanLimitBody, PLAN_HEADER, PLAN_LIMITS } from "@/lib/plan";
import { hasActiveEntitlement, readPlanUsage, resolvePlan } from "@/lib/serverPlan";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;

/** RevenueCat's GET /v1/subscribers/{id} answer, with one entitlement. */
function subscriber(entitlement: Record<string, unknown> | null, name = "nexdo_pro") {
  return {
    request_date_ms: NOW,
    subscriber: { entitlements: entitlement ? { [name]: entitlement } : {} },
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("the plans", () => {
  it("match the pricing table: counts as they are, time in minutes", () => {
    const shown = (plan: "free" | "pro") => ({
      chat: displayLimit(plan, "chat"),
      media: displayLimit(plan, "media"),
      voice: displayLimit(plan, "voice"),
      live: displayLimit(plan, "live"),
      assist: displayLimit(plan, "assist"),
    });
    assert.deepEqual(shown("free"), { chat: 20, media: 3, voice: 3, live: 0, assist: 5 });
    assert.deepEqual(shown("pro"), { chat: 400, media: 50, voice: 50, live: 50, assist: 100 });
    // Voice and Live voice are counted in seconds.
    assert.equal(PLAN_LIMITS.free.voice, 180);
    assert.equal(PLAN_LIMITS.pro.live, 3000);
  });

  it("recognises the server's limit answer, and nothing else", () => {
    assert.equal(isPlanLimitBody({ error: "plan_limit", meter: "chat", plan: "free" }), true);
    assert.equal(isPlanLimitBody({ error: "daily_limit" }), false);
    assert.equal(isPlanLimitBody({ error: "plan_limit", meter: "coffee", plan: "free" }), false);
    assert.equal(isPlanLimitBody(null), false);
  });
});

describe("reading RevenueCat's answer", () => {
  it("is Pro while the entitlement hasn't ended", () => {
    assert.equal(hasActiveEntitlement(subscriber({ expires_date: iso(NOW + HOUR) })), true);
  });

  it("is not Pro once it has ended — RevenueCat still lists lapsed entitlements", () => {
    assert.equal(hasActiveEntitlement(subscriber({ expires_date: iso(NOW - HOUR) })), false);
  });

  it("stays Pro through the store's grace period for a failed renewal", () => {
    const lapsed = { expires_date: iso(NOW - HOUR), grace_period_expires_date: iso(NOW + HOUR) };
    assert.equal(hasActiveEntitlement(subscriber(lapsed)), true);
  });

  it("treats an entitlement with no end date as lifetime", () => {
    assert.equal(hasActiveEntitlement(subscriber({ expires_date: null })), true);
  });

  it("is not Pro with no entitlement, another entitlement, or a malformed answer", () => {
    assert.equal(hasActiveEntitlement(subscriber(null)), false);
    assert.equal(hasActiveEntitlement(subscriber({ expires_date: iso(NOW + HOUR) }, "something_else")), false);
    assert.equal(hasActiveEntitlement(subscriber({})), false);
    assert.equal(hasActiveEntitlement(null), false);
    assert.equal(hasActiveEntitlement("nope"), false);
  });

  it("goes by RevenueCat's clock, not this server's", () => {
    // Ended an hour before RevenueCat answered — whatever time this machine thinks it is.
    const answer = { ...subscriber({ expires_date: iso(NOW - HOUR) }), request_date_ms: NOW };
    assert.equal(hasActiveEntitlement(answer), false);
  });
});

describe("what the month has used (Settings → Nexdo Pro)", () => {
  it("reads this account's rows for the current UTC month, and counts a meter with no row as 0", async (t) => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://db.nexdo.test";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const fetchMock = t.mock.method(globalThis, "fetch", async () =>
      Response.json([
        { meter: "chat", used: 12 },
        { meter: "voice", used: 95 },
        { meter: "something_old", used: 4 },
      ]),
    );
    assert.deepEqual(await readPlanUsage("user_1"), { chat: 12, media: 0, voice: 95, live: 0, assist: 0 });

    const url = new URL(String(fetchMock.mock.calls[0].arguments[0]));
    assert.equal(url.origin + url.pathname, "https://db.nexdo.test/rest/v1/ai_plan_usage");
    assert.equal(url.searchParams.get("user_id"), "eq.user_1");
    assert.equal(url.searchParams.get("month"), `eq.${new Date().toISOString().slice(0, 7)}-01`);
  });

  it("is null, not zeros, when the counts can't be read", async (t) => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://db.nexdo.test";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 500 }));
    t.mock.method(console, "error", () => {});
    assert.equal(await readPlanUsage("user_1"), null);
  });
});

describe("which plan a request is on", () => {
  it("is Free, without asking RevenueCat, unless the app claims Pro", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("RevenueCat must not be asked");
    });
    const request = new Request("https://nexdo.test/api/inbox", { method: "POST" });
    assert.equal(await resolvePlan(request, "user_free"), "free");
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("checks a Pro claim with RevenueCat, and remembers the answer", async (t) => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY = "test_key";
    const fetchMock = t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      assert.equal(String(url), "https://api.revenuecat.com/v1/subscribers/user_pro");
      return Response.json({ request_date_ms: Date.now(), subscriber: { entitlements: { nexdo_pro: { expires_date: iso(Date.now() + HOUR) } } } });
    });
    const request = new Request("https://nexdo.test/api/inbox", { method: "POST", headers: { [PLAN_HEADER]: "pro" } });
    assert.equal(await resolvePlan(request, "user_pro"), "pro");
    assert.equal(await resolvePlan(request, "user_pro"), "pro");
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it("doesn't believe a Pro claim RevenueCat doesn't back", async (t) => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY = "test_key";
    t.mock.method(globalThis, "fetch", async () => Response.json({ request_date_ms: Date.now(), subscriber: { entitlements: {} } }));
    const request = new Request("https://nexdo.test/api/inbox", { method: "POST", headers: { [PLAN_HEADER]: "pro" } });
    assert.equal(await resolvePlan(request, "user_pretending"), "free");
  });

  it("treats everyone as Free when RevenueCat refuses the key", async (t) => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY = "wrong_key";
    t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 401 }));
    t.mock.method(console, "error", () => {});
    const request = new Request("https://nexdo.test/api/inbox", { method: "POST", headers: { [PLAN_HEADER]: "pro" } });
    assert.equal(await resolvePlan(request, "user_bad_key"), "free");
  });

  it("takes the app's word when RevenueCat can't be reached", async (t) => {
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY = "test_key";
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("network down");
    });
    t.mock.method(console, "warn", () => {});
    const request = new Request("https://nexdo.test/api/inbox", { method: "POST", headers: { [PLAN_HEADER]: "pro" } });
    assert.equal(await resolvePlan(request, "user_outage"), "pro");
  });
});
