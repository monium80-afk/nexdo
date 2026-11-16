/// <reference types="node" />
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Platform } from "react-native";

afterEach(() => {
  Platform.OS = "ios";
});

describe("the React Native Platform stub", () => {
  it("selects the Android option before falling back to default", () => {
    Platform.OS = "android";
    assert.equal(Platform.select({ ios: "iOS", android: "Android", default: "default" }), "Android");

    Platform.OS = "web";
    assert.equal(Platform.select({ ios: "iOS", default: "default" }), "default");
  });
});
