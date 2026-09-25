import assert from "node:assert/strict";
import test from "node:test";
import { createBcCommand } from "./index.js";

test("bc command definition exports standard contract", () => {
  const def = createBcCommand();
  assert.equal(def.name, "bc");
  assert.equal(typeof def.execute, "function");
});
