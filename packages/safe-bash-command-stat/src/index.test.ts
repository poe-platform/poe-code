import assert from "node:assert/strict";
import test from "node:test";
import { createStatCommand, createStatCommands, statCommands } from "./index.js";
test("stat exports its command and plugin", () => {
  assert.equal(createStatCommand().name, "stat");
  assert.equal(createStatCommands().length, 1);
  assert.equal(statCommands().name, "stat-commands");
});
