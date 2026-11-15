/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveTaskReference } from "@/lib/ai/resolveTaskReference";

import { makeTask } from "./helpers";

describe("resolveTaskReference", () => {
  it("resolves a unique explicit partial title before the current-task fallback", () => {
    const result = resolveTaskReference(
      "review proposal",
      {
        currentTaskId: "current",
        recentTaskIds: [],
        tasks: [
          makeTask({ id: "current", title: "Call dentist" }),
          makeTask({ id: "proposal", title: "Review proposal" }),
        ],
      },
    );
    assert.deepEqual(result, { status: "resolved", taskId: "proposal" });
  });

  it("does not let a recent completed match override the preferred open match", () => {
    const result = resolveTaskReference(
      "review proposal",
      {
        currentTaskId: "completed",
        recentTaskIds: ["completed"],
        tasks: [
          makeTask({ id: "open", title: "Review proposal", status: "pending" }),
          makeTask({ id: "completed", title: "Review proposal", status: "completed" }),
        ],
      },
      { includeCompleted: true },
    );
    assert.deepEqual(result, { status: "resolved", taskId: "open" });
  });
});
