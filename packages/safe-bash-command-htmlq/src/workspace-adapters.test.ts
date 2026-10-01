import assert from "node:assert/strict";
import { test } from "node:test";
import { evalSyncHtmlq } from "./index.js";

test("owns the standalone synchronous htmlq adapter", () => {
  assert.equal(evalSyncHtmlq(new TextEncoder().encode("<p>hello</p>"), ["-t", "p"]), "hello\n");
});
