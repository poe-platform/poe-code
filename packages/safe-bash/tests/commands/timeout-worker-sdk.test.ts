import assert from "node:assert/strict";
import test from "node:test";
import { runBash } from "../../src/execution.node.js";
import { createMemoryFileSystem } from "../../src/index.js";

test("Node SDK execution supplies the same escalation policy as public Shell", async () => {
  const result = await runBash({ fs: createMemoryFileSystem(), source: "timeout -k0.02 2 printf retained" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "retained");
  assert.equal(result.stderr, "");
});

test("Node SDK literal argv entry is not replayed as a host closure", async () => {
  const result = await runBash({ fs: createMemoryFileSystem(), command: "timeout", args: ["-k0.02", "2", "printf", "literal"] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "literal");
  assert.equal(result.stderr, "");
});
