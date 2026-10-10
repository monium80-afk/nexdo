/// <reference types="node" />
// Messages and questions on the web build, where react-native-web's
// Alert.alert does nothing: the browser's own dialogs stand in.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Platform } from "react-native";

import { showAlert } from "@/lib/alert";

import { alertCalls } from "./stubs/react-native";

const browser = globalThis as unknown as { window?: { confirm: (text: string) => boolean; alert: (text: string) => void } };

/** The web build, with a browser that answers `answer` to confirm(). */
function onWeb(answer: boolean) {
  Platform.OS = "web";
  const shown: string[] = [];
  browser.window = {
    confirm: (text) => {
      shown.push(text);
      return answer;
    },
    alert: (text) => {
      shown.push(text);
    },
  };
  return shown;
}

afterEach(() => {
  Platform.OS = "ios";
  delete browser.window;
  alertCalls.length = 0;
});

describe("showAlert", () => {
  it("asks natively on a phone, unchanged", () => {
    const buttons = [{ text: "Cancel", style: "cancel" as const }];
    showAlert("Clear history?", "This can't be undone.", buttons);
    assert.deepEqual(alertCalls, [["Clear history?", "This can't be undone.", buttons]]);
  });

  it("on the web, asks Cancel-or-action with confirm() and does the action on yes", () => {
    const shown = onWeb(true);
    const done: string[] = [];
    showAlert("Clear history?", "This can't be undone.", [
      { text: "Cancel", style: "cancel", onPress: () => done.push("cancel") },
      { text: "Clear", style: "destructive", onPress: () => done.push("clear") },
    ]);
    assert.deepEqual(shown, ["Clear history?\n\nThis can't be undone."]);
    assert.deepEqual(done, ["clear"]);
  });

  it("on the web, a no to confirm() is Cancel", () => {
    onWeb(false);
    const done: string[] = [];
    showAlert("Sign out anyway?", undefined, [
      { text: "Cancel", style: "cancel", onPress: () => done.push("cancel") },
      { text: "Sign out", onPress: () => done.push("sign out") },
    ]);
    assert.deepEqual(done, ["cancel"]);
  });

  it("on the web, a message is alert()", () => {
    const shown = onWeb(true);
    showAlert("Couldn't open the link.");
    assert.deepEqual(shown, ["Couldn't open the link."]);
  });

  it("on the web, a choice between two actions only shows its message", () => {
    const shown = onWeb(true);
    const done: string[] = [];
    showAlert("Delete which?", "A repeating task.", [
      { text: "Cancel", style: "cancel" },
      { text: "Just this one", onPress: () => done.push("this") },
      { text: "The whole series", onPress: () => done.push("series") },
    ]);
    assert.deepEqual(shown, ["Delete which?\n\nA repeating task."]);
    assert.deepEqual(done, []);
  });
});
