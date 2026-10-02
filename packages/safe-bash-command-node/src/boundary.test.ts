import assert from "node:assert/strict";
import test from "node:test";

test("Node provider command is owned by its private workspace", async () => {
  const command = await import("./commands/node/index.js");
  assert.equal(command.createNodeCommand().name, "node");
  assert.equal(command.NODE_PROFILE, "NP1-CJS-WRQ-L-SYNC-1");
});
