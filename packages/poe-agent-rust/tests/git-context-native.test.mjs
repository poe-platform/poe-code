import { test } from "node:test";
import assert from "node:assert/strict";
import { gitContextPlugin } from "../dist/index.js";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
test("Git context export and native formatter preserve UTF16 host parts", () => {
  assert.equal(gitContextPlugin("/project").name, "git-context");
  for (const parts of [
    [],
    ["## Git context"],
    ["system", "## Git context", "M file\n", "abc commit\n"],
    ["a\ud800", "b🌍"]
  ])
    assert.equal(native.agentGitContext(parts), parts.join("\n"));
  assert.throws(() => native.agentGitContext(["x".repeat(8388608), "y"]), /limit/);
});
