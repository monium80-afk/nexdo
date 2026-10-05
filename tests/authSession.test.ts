/// <reference types="node" />
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
  return { flow, finish, runs: () => runs };
}

afterEach(() => {
  Platform.OS = "ios";
  dismissCalls.count = 0;
});

describe("runAuthSession", () => {
  it("skips a second tap while the first sign-in is open, then runs the next one", async () => {
    const first = openFlow();
    const second = openFlow();
    const third = openFlow();

    const firstRun = runAuthSession(first.flow);
    await runAuthSession(second.flow);
    assert.equal(second.runs(), 0);
    assert.equal(dismissCalls.count, 1);

    first.finish();
    await firstRun;
    third.finish();
    await runAuthSession(third.flow);
    assert.equal(first.runs(), 1);
    assert.equal(third.runs(), 1);
  });

  it("runs the next sign-in after the last one throws", async () => {
    await assert.rejects(
      runAuthSession(async () => {
        throw new Error("cancelled");
      }),
    );

    const next = openFlow();
    next.finish();
    await runAuthSession(next.flow);
    assert.equal(next.runs(), 1);
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
