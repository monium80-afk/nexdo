/// <reference types="node" />
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { purchasesTestState } from "./stubs/purchases";

let purchases!: typeof import("@/lib/purchases");

before(async () => {
  process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY = "test-key";
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = "ios-key";
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
  purchases = await import("@/lib/purchases");
});

describe("purchaser identification failures", () => {
  it("blocks purchase and restore until identification succeeds, and exposes the failure", async () => {
    const failure = new Error("identification failed");
    purchasesTestState.identifyFailure = failure;
    purchasesTestState.purchaseCalls = 0;
    purchasesTestState.restoreCalls = 0;

    await assert.rejects(purchases.identifyPurchaser("user-1"), failure);

    const plan = { product: { identifier: "monthly" } } as Parameters<typeof purchases.purchasePlan>[0];
    assert.equal(await purchases.purchasePlan(plan), "error");
    assert.equal(await purchases.restorePurchases(), "error");
    assert.equal(purchasesTestState.purchaseCalls, 0);
    assert.equal(purchasesTestState.restoreCalls, 0);

    purchasesTestState.identifyFailure = null;
    await purchases.identifyPurchaser("user-1");

    assert.equal(await purchases.purchasePlan(plan), "purchased");
    assert.equal(await purchases.restorePurchases(), "restored");
    assert.equal(purchasesTestState.purchaseCalls, 1);
    assert.equal(purchasesTestState.restoreCalls, 1);
  });
});
