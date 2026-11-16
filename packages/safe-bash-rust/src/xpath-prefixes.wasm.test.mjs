import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Native libxml2 XPath contexts do not register document namespace declarations.
const xml = '<r xmlns="urn:r" xmlns:p="urn:p" a="v" xml:lang="en"><p:i p:a="z"/><i/><i xmlns=""/></r>';
const cases = [
  ["count(//i)", 0, "1\n"],
  ["count(/*/*)", 0, "3\n"],
  ["count(/*/@*)", 0, "2\n"],
  ["/*/@a", 0, ' a="v"\n'],
  ["string(/*/@xml:lang)", 0, "en\n"],
  ["namespace-uri(/*/*[1])", 0, "urn:p\n"],
  ["count(/*/p:i)", 10, "", "p"],
  ["/*/*/@p:a", 10, "", "p"],
  ["/*/missing:i", 10, "", "missing"],
  ["count(/*/missing:i)", 10, "", "missing"],
];
for (const runtime of ["TypeScript", "Rust"]) for (const [query, status, output, prefix] of cases) {
  test(`${runtime}: XPath query namespaces ${query}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, agentCommands, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
    const fs = createMemoryFileSystem();
    const shell = runtime === "TypeScript" ? new Shell({fs}).use(agentCommands()) : new RustWasmBash({fs, forceNative: true});
    try {
      const result = await shell.exec(`xmllint --xpath '${query}' -`, {stdin: xml});
      assert.equal(result.exitCode, status, result.stderr);
      assert.equal(result.stdout, output);
      assert.equal(result.stderr, prefix ? `xmllint: undefined XPath namespace prefix: ${prefix}\n` : "");
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally { await shell.dispose(); }
  });
}
