import assert from "node:assert/strict";
import { test } from "node:test";
import { runVirtual } from "./helpers.js";

test("awk reads input operands with the current execution budget", async () => {
  const result = await runVirtual("awk", { args: ['{print}', 'input.txt'], files: {'input.txt':'hello\n'} });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), 'hello\n');
});
