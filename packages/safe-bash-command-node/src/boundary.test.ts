import assert from "node:assert/strict";
import test from "node:test";

test("Node provider command is owned by its private workspace", async () => {
  const command = await import("./commands/node/index.js");
  assert.equal(command.createNodeCommand().name, "node");
  assert.equal(command.NODE_PROFILE, "NP1-CJS-WRQ-L-SYNC-1");
});


test("Node and SafeJS compatibility routes share the bridge and limit error owner", async () => {
  const bridge = await import("safe-bash-command-safejs");
  const legacy = await import("./commands/safejs/runtime.js");
  const legacyTypes = await import("./commands/safejs/types.js");
  assert.equal(legacy.createSafeJsCommands, bridge.createSafeJsCommands);
  assert.equal(legacyTypes.SafeJsCommandLimitError, bridge.SafeJsCommandLimitError);
  assert.ok(new legacyTypes.SafeJsCommandLimitError("maxOutputBytes") instanceof bridge.SafeJsCommandLimitError);
});
