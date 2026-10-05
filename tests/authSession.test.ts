/// <reference types="node" />
// Google/Apple sign-in, one at a time: a second tap while the browser is
// still open must not start a second auth session.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Platform } from "react-native";

import { dismissAuthSession, runAuthSession } from "@/lib/authSession";

import { dismissCalls } from "./stubs/web-browser";

/** A sign-in that stays open until the test calls `finish`. */
function openFlow() {
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let runs = 0;
  const flow = async () => {
    runs += 1;
    await done;
  };
  return { flow, finish: () => finish(), runs: () => runs };
}

afterEach(() => {
  Platform.OS = "ios";
  dismissCalls.count = 0;
});

describe("runAuthSession", () => {
  it("skips a second tap while the first sign-in is open", async () => {
    const first = openFlow();
    const second = openFlow();

    const firstRun = runAuthSession(first.flow);
    assert.equal(await runAuthSession(second.flow), false);
    assert.equal(second.runs(), 0);

    first.finish();
    assert.equal(await firstRun, true);
    assert.equal(first.runs(), 1);
  });

  it("starts a new sign-in once the last one ends", async () => {
    const first = openFlow();
    const firstRun = runAuthSession(first.flow);
    first.finish();
    await firstRun;

    const second = openFlow();
    const secondRun = runAuthSession(second.flow);
    second.finish();
    assert.equal(await secondRun, true);
    assert.equal(second.runs(), 1);
  });

  it("starts a new sign-in after the last one throws", async () => {
    await assert.rejects(
      runAuthSession(async () => {
        throw new Error("cancelled");
      }),
    );

    const next = openFlow();
    const nextRun = runAuthSession(next.flow);
    next.finish();
    assert.equal(await nextRun, true);
  });

  it("closes a sheet left open before it starts", async () => {
    const flow = openFlow();
    const run = runAuthSession(flow.flow);
    assert.equal(dismissCalls.count, 1);
    flow.finish();
    await run;
  });
});

describe("dismissAuthSession", () => {
  it("closes the sheet on iOS and the web", () => {
    dismissAuthSession();
    Platform.OS = "web";
    dismissAuthSession();
    assert.equal(dismissCalls.count, 2);
  });

  it("leaves Android alone, where expo-web-browser has no way to close it", () => {
    Platform.OS = "android";
    dismissAuthSession();
    assert.equal(dismissCalls.count, 0);
  });
});
