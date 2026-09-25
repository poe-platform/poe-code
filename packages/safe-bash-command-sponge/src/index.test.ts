import assert from "node:assert/strict";
import test from "node:test";
import { createSpongeCommand } from "./index.js";

test("sponge command definition exports standard contract", () => {
  const def = createSpongeCommand();
  assert.equal(def.name, "sponge");
  assert.equal(typeof def.execute, "function");
});
