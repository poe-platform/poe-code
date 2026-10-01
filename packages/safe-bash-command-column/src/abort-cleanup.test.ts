import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { ColumnInputs } from "./internal.js";
import { settings } from "./options.js";

test("column releases stat listeners after successful and failed opens", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("one two\n"));
  const context: CommandContext = { command: "column", args: [], fs, signal: new AbortController().signal, cwd: "/", env: {},
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } };
  const inputs = new ColumnInputs(context, settings({}));
  const baseline = getEventListeners(inputs.signal, "abort").length;
  try {
    await inputs.open("/input");
    assert.equal(getEventListeners(inputs.signal, "abort").length, baseline);
    await assert.rejects(inputs.open("/missing"));
    assert.equal(getEventListeners(inputs.signal, "abort").length, baseline);
  } finally { await inputs.close(); }
});
