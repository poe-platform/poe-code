import assert from "node:assert/strict";
import { test } from "node:test";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
import { createOpCommand } from "./index.js";

test("registers standalone op executors with their version metadata", () => {
  const command = createOpCommand({ version: "1.2.3" });
  assert.equal(builtInDirectContextExecutors.has(command.execute), true);
  assert.equal(syncCommandEvaluators.evalSyncOp?.(command.execute, ["--version"], {}), "1.2.3\n");
});
