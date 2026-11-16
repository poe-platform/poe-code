import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// libxml2 permits path steps after attributes and text; these nodes have no children.
const xml = '<r><a n="2">first</a><a n="4">second</a></r>';
for (const runtime of ["TypeScript", "Rust"]) for (const [query, expected] of [
  ["count(//a/@n/b)", "0\n"],
  ["count(//a/text()/b)", "0\n"],
  ["count(//a/@n/..)", "2\n"],
  ["count(//a/text()/..)", "2\n"],
  ["name(//a/@n/..)", "a\n"],
  ["string(//a/text()/..)", "first\n"],
  ["count(//a/@n/../@n)", "2\n"],
  ["count(//a/@n[last()]/..)", "2\n"],
]) {
  test(`${runtime}: XPath node traversal ${query}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, agentCommands, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
    const fs = createMemoryFileSystem();
    const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands()) : new RustWasmBash({fs, forceNative: true});
    try {
      const result = await shell.exec(`xmllint --xpath '${query}' -`, {stdin: xml});
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally { await shell.dispose(); }
  });
}
