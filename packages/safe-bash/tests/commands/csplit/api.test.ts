import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../../src/commands/csplit/index.js";
import { createCsplitCommandWithExecutor, evalSyncCsplit } from "safe-bash-command-csplit/command";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { evaluateCommandSupport } from "../../../src/contracts/command-requirements.js";

test("public csplit entry exposes the factories and canonical synchronous evaluator", () => {
  assert.deepEqual(Object.keys(entry).sort(), ["createCsplitCommand", "createCsplitCommands", "csplitCommands", "evalSyncCsplit"]);
  assert.equal(entry.evalSyncCsplit, evalSyncCsplit);
});

test("public csplit evaluator uses supplied output capabilities for line splits", () => {
  const input = new TextEncoder().encode("first\nsecond\nthird\n");
  assert.equal(entry.evalSyncCsplit(input, ["-", "2"]), undefined);
  const files = new Map<string, string>();
  const result = entry.evalSyncCsplit(input, ["-", "2"], undefined, (path, bytes) => {
    files.set(path, new TextDecoder().decode(bytes));
    return true;
  });
  assert.equal(result, "6\n13\n");
  assert.deepEqual([...files], [["xx00", "first\n"], ["xx01", "second\nthird\n"]]);
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
