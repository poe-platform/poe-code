import assert from "node:assert/strict";
import test from "node:test";
import { createYesCommand, createYesCommands, yesCommands, settings } from "./index.js";

test("yes command exports standard contract", () => {
  const cmd = createYesCommand();
  assert.equal(cmd.name, "yes");
  assert.equal(createYesCommands().length, 1);
  assert.equal(yesCommands().name, "yes-commands");
  assert.equal(settings({ maxRecordBytes: 1024 }).maxRecordBytes, 1024);
});
