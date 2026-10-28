/// <reference types="node" />
// The free trial the paywall promises: what the store says this account would
// get — Google Play's default offer, the App Store's introductory offer.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { storeTrial } from "@/lib/freeTrial";

type Product = Parameters<typeof storeTrial>[0];

/** The free pricing phase of a Google Play offer: `value` units, repeated `cycles` times. */
const freePhase = (value: number, unit: string, cycles: number | null = 1) => ({
  billingPeriod: { value, unit, iso8601: `P${value}${unit[0]}` },
  billingCycleCount: cycles,
  price: { formatted: "Free", amountMicros: 0, currencyCode: "USD" },
});

/** A Google Play subscription whose default option — what a purchase buys — has this free phase, or none. */
const playProduct = (phase: ReturnType<typeof freePhase> | null) =>
  ({ defaultOption: { freePhase: phase }, introPrice: null }) as unknown as Product;

/** An App Store subscription with this introductory offer, or none. */
const appStoreProduct = (introPrice: { price: number; periodUnit: string; periodNumberOfUnits: number; cycles: number } | null) =>
  ({ defaultOption: null, introPrice }) as unknown as Product;

describe("the free trial a plan shows", () => {
  it("is Google Play's free phase: the yearly plan's 3 days", () => {
    assert.deepEqual(storeTrial(playProduct(freePhase(3, "DAY"))), { count: 3, unit: "day" });
  });

  it("is none on Google Play once the account can't have the offer, whatever the intro price says", () => {
    // Google leaves the offer out, so the default option is the bare base plan.
    const product = {
      defaultOption: { freePhase: null },
      introPrice: { price: 0, periodUnit: "DAY", periodNumberOfUnits: 3, cycles: 1 },
    } as unknown as Product;
    assert.equal(storeTrial(product), null);
  });

  it("counts every cycle of a repeating free phase", () => {
    assert.deepEqual(storeTrial(playProduct(freePhase(1, "WEEK", 2))), { count: 2, unit: "week" });
  });

  it("is the App Store's free introductory offer", () => {
    const product = appStoreProduct({ price: 0, periodUnit: "DAY", periodNumberOfUnits: 3, cycles: 1 });
    assert.deepEqual(storeTrial(product), { count: 3, unit: "day" });
  });

  it("is none for a paid introductory price, or no offer at all", () => {
    assert.equal(storeTrial(appStoreProduct({ price: 0.99, periodUnit: "MONTH", periodNumberOfUnits: 1, cycles: 3 })), null);
    assert.equal(storeTrial(appStoreProduct(null)), null);
  });

  it("is none for a period it can't name", () => {
    assert.equal(storeTrial(playProduct(freePhase(3, "UNKNOWN"))), null);
  });
});
