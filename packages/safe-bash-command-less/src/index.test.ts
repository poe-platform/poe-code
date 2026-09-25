import assert from "node:assert/strict";
import test from "node:test";
import { createLessCommand } from "./index.js";

test("less command definition exports standard contract", () => {
  const def = createLessCommand();
  assert.equal(def.name, "less");
  assert.equal(typeof def.execute, "function");
});
