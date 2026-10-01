import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { createDiff3Engine } from "./engine.js";

test("diff3 releases abort listeners on success, failure and disposal", () => {
  const controller = new AbortController();
  for (const mode of ["success", "failure", "dispose"]) {
    const engine = createDiff3Engine({}, {}, controller.signal);
    if (mode === "success") {
      for (const file of ["base", "left", "right"] as const) engine.end(file);
      engine.finish();
    } else if (mode === "failure") assert.throws(() => engine.finish());
    else engine.dispose();
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    engine.dispose();
  }
});
