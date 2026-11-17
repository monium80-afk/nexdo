/// <reference types="node" />
// The free-trial reminder onboarding's timeline promises: two days before the
// trial turns into a paid plan, and only while that's still going to happen.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { trialReminderTime } from "@/lib/trialReminder";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 5, 12, 0, 0);

const entitlement = (overrides: Partial<{ periodType: string; willRenew: boolean; expirationDate: string | null }> = {}) => ({
  periodType: "TRIAL",
  willRenew: true,
  expirationDate: new Date(now + 7 * DAY).toISOString(),
  ...overrides,
});

describe("trialReminderTime", () => {
  it("fires two days before a running trial ends", () => {
    assert.equal(trialReminderTime(entitlement(), now), now + 5 * DAY);
  });

  it("stays quiet once the trial is cancelled — nothing will be charged", () => {
    assert.equal(trialReminderTime(entitlement({ willRenew: false }), now), null);
  });

  it("stays quiet for a paid period, and without Pro", () => {
    assert.equal(trialReminderTime(entitlement({ periodType: "NORMAL" }), now), null);
    assert.equal(trialReminderTime(null, now), null);
  });

  it("skips a reminder whose time has already passed", () => {
    assert.equal(trialReminderTime(entitlement({ expirationDate: new Date(now + DAY).toISOString() }), now), null);
  });

  it("ignores a missing or unreadable end date", () => {
    assert.equal(trialReminderTime(entitlement({ expirationDate: null }), now), null);
    assert.equal(trialReminderTime(entitlement({ expirationDate: "soon" }), now), null);
  });
});
