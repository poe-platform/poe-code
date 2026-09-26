import assert from "node:assert/strict";
import test from "node:test";
import { createOdCommand, createOdCommands, odCommands } from "./index.js";

test("od command definition exports standard contract", () => {
  const def = createOdCommand();
  assert.equal(def.name, "od");
  assert.equal(typeof def.execute, "function");
  assert.equal(createOdCommands().length, 1);
  assert.equal(odCommands().name, "od-commands");
});
