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

test("yes settings disable the record ceiling unless configured", () => {
  assert.equal(settings().maxRecordBytes, Infinity);
  assert.equal(settings({ maxRecordBytes: Infinity }).maxRecordBytes, Infinity);
  assert.equal(settings().chunkBytes, 16384);
});
