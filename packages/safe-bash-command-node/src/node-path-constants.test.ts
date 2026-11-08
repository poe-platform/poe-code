import assert from "node:assert/strict";
import test from "node:test";
import { createNodePathModule } from "./commands/node/path.js";
import type { SafeJsRuntime } from "./commands/safejs/types.js";

test("path constants are not declared as host operations", () => {
  const runtime = {
    declareHostOperation(operation: Parameters<SafeJsRuntime<unknown>["declareHostOperation"]>[0]) {
      assert.equal(typeof operation, "function");
      return operation;
    },
  } as unknown as SafeJsRuntime<unknown>;
  const module = createNodePathModule(runtime, "/work");
  assert.equal(module.sep, "/");
  assert.equal(module.delimiter, ":");
});
