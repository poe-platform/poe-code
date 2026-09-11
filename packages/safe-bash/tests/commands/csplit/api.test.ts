import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../../src/commands/csplit/index.js";
import { createCsplitCommandWithExecutor } from "../../../src/commands/csplit/command.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { evaluateCommandSupport } from "../../../src/contracts/command-requirements.js";

test("public csplit entry exposes only the requested three factories", () => {
  assert.deepEqual(Object.keys(entry).sort(), ["createCsplitCommand", "createCsplitCommands", "csplitCommands"]);
});

test("internal executor factory remains available for preset composition", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  try { assert.equal(createCsplitCommandWithExecutor(executor).name, "csplit"); }
  finally { await executor.dispose(); }
});

test("csplit declares atomic output support and refuses readonly capability metadata", () => {
  const command = entry.createCsplitCommand();
  assert.equal(evaluateCommandSupport(command, { atomicFileMutation: true }).status, "supported");
  assert.equal(evaluateCommandSupport(command, { atomicFileMutation: false }).status, "unsupported");
  assert.equal(evaluateCommandSupport(command, { atomicFileMutation: true, readOnly: true }).status, "unsupported");
});
