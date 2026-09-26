import assert from "node:assert/strict";
import test from "node:test";
import { createXxdCommand, createXxdCommands, xxdCommands } from "./index.js";

test("xxd command definition exports standard contract", () => {
  const def = createXxdCommand();
  assert.equal(def.name, "xxd");
  assert.equal(typeof def.execute, "function");
  assert.equal(createXxdCommands().length, 1);
  assert.equal(xxdCommands().name, "xxd-commands");
});
