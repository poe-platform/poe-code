import assert from "node:assert/strict";
import test from "node:test";
import { createFdCommand } from "./index.js";

test("fd command definition exports standard contract", () => {
  const def = createFdCommand();
  assert.equal(def.name, "fd");
  assert.equal(typeof def.execute, "function");
});
