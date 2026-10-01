import assert from "node:assert/strict";
import test from "node:test";
import { createChmodCommand, createChmodCommands, chmodCommands } from "./index.js";
test("chmod exports its command and plugin", () => {
  assert.equal(createChmodCommand().name, "chmod");
  assert.equal(createChmodCommands().length, 1);
  assert.equal(chmodCommands().name, "chmod-commands");
});
