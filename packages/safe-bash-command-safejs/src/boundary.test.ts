import assert from "node:assert/strict";
import test from "node:test";

test("SafeJS bridge owns its bounded command and canonical limit error", async () => {
  const { createSafeJsCommands } = await import("./runtime.js");
  const { invocation } = await import("./options.js");
  const definitions = createSafeJsCommands({}, { name: "safejs", description: "Injected engine", help: "help", invocation });
  assert.equal(definitions[0]?.name, "safejs");
  assert.throws(() => createSafeJsCommands({ limits: { maxOutputBytes: -1 } }, { name: "safejs", description: "", help: "", invocation }), RangeError);
});
