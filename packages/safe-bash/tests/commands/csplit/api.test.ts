import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../../src/commands/csplit/index.js";
import { createCsplitCommandWithExecutor } from "../../../src/commands/csplit/command.js";
import { RegexExecutor } from "../../../src/commands/regex-execution/portable.js";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";

test("public csplit entry exposes only the requested three factories", () => {
  assert.deepEqual(Object.keys(entry).sort(), ["createCsplitCommand", "createCsplitCommands", "csplitCommands"]);
});

test("internal executor factory remains available for preset composition", async () => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  try { assert.equal(createCsplitCommandWithExecutor(executor).name, "csplit"); }
  finally { await executor.dispose(); }
});
