/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectRelevantTasks } from "@/lib/ai/context";

import { makeTask } from "./helpers";

describe("relevant AI task selection", () => {
  it("selects named tasks before older recent tasks use the context budget", () => {
    const tasks = [
      makeTask({ id: "recent", title: "Old task" }),
      makeTask({ id: "named", title: "Target report" }),
    ];
    assert.deepEqual(selectRelevantTasks("Update Target report", tasks, ["recent"], undefined, 1).map((task) => task.id), ["named"]);
  });

  it("prefers an open duplicate unless the request explicitly targets completed work", () => {
    const tasks = [
      makeTask({ id: "done", title: "Review report", status: "completed" }),
      makeTask({ id: "open", title: "Review report", status: "pending" }),
    ];
    assert.deepEqual(selectRelevantTasks("Review report", tasks, [], undefined, 1).map((task) => task.id), ["open"]);
    assert.deepEqual(selectRelevantTasks("Reopen the completed Review report", tasks, [], undefined, 1).map((task) => task.id), ["done"]);
  });

  it("retains recent task context when the request names no task", () => {
    const tasks = [makeTask({ id: "recent", title: "Old task" }), makeTask({ id: "other", title: "Other task" })];
    assert.deepEqual(selectRelevantTasks("What should I do next?", tasks, ["recent"], undefined, 1).map((task) => task.id), ["recent"]);
  });
});
