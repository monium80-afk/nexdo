/// <reference types="node" />
// Magic mic usage reports: each is kept on the phone until the server has it,
// and only ever sent for the account whose session it was.
import AsyncStorage from "@react-native-async-storage/async-storage";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { flushLiveUsageReports, reportLiveUsage } from "@/lib/liveUsageReports";

import { apiCalls, setApiHandler } from "./stubs/api";

const SESSION = "3f2b9c1e-5d4a-4b8e-9a7c-1e2d3f4a5b6c";

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

let online = true;
const reports = () => apiCalls.filter((call) => call.path === "/api/live-usage").map((call) => call.body);

beforeEach(async () => {
  await AsyncStorage.clear();
  apiCalls.length = 0;
  online = true;
  setApiHandler(() => {
    if (!online) throw new Error("/api/live-usage failed: network");
    return { ok: true };
  });
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(console, "warn", () => {});
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe("Magic mic usage reports", () => {
  it("sends a session's report, and keeps nothing once it's through", async () => {
    await reportLiveUsage("user_a", { sessionId: SESSION, seconds: 42 });
    assert.deepEqual(reports(), [{ sessionId: SESSION, seconds: 42 }]);
    assert.equal(await flushLiveUsageReports("user_a"), false);
    assert.equal(reports().length, 1, "nothing is sent twice");
  });

  it("tries a report that couldn't be sent again, until it gets through", async () => {
    online = false;
    const reporting = reportLiveUsage("user_a", { sessionId: SESSION, seconds: 42 });
    await settle();
    assert.equal(reports().length, 1);

    online = true;
    mock.timers.tick(5_000);
    await reporting;
    assert.equal(reports().length, 2);
    assert.equal(await flushLiveUsageReports("user_a"), false, "nothing left waiting");
  });

  it("keeps it on the phone past the retries, for the next sign-in", async () => {
    online = false;
    const reporting = reportLiveUsage("user_a", { sessionId: SESSION, seconds: 42 });
    for (const delay of [5_000, 30_000, 120_000]) {
      await settle();
      mock.timers.tick(delay);
    }
    await reporting;

    online = true;
    assert.equal(await flushLiveUsageReports("user_a"), false);
    assert.deepEqual(reports().at(-1), { sessionId: SESSION, seconds: 42 });
  });

  it("waits for its own account: signed in as someone else, it isn't sent", async () => {
    online = false;
    const reporting = reportLiveUsage("user_a", { sessionId: SESSION, seconds: 42 });
    for (const delay of [5_000, 30_000, 120_000]) {
      await settle();
      mock.timers.tick(delay);
    }
    await reporting;
    online = true;
    const sentBefore = reports().length;

    assert.equal(await flushLiveUsageReports("user_b"), false);
    assert.equal(reports().length, sentBefore);
    await flushLiveUsageReports("user_a");
    assert.equal(reports().length, sentBefore + 1);
  });
});
