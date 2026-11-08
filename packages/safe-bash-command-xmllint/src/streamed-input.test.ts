import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";

for (const file of [false, true]) test(`XML parsing stops its input at a node limit (file=${file})`, async () => {
  let closed = false, diagnostics = "";
  const source = { async *[Symbol.asyncIterator]() {
    try {
      yield new TextEncoder().encode("<r><x/>");
      assert.fail("XML parser must enforce its node budget before requesting another chunk");
    } finally { closed = true; }
  } };
  const fs = createMemoryFileSystem();
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("XML input must use injected streaming reads");
    if (key === "readStream") return () => source;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await createXmllintCommand({ limits: { maxNodes: 1 } }).execute({ command: "xmllint",
    ...createCommandArguments(["--noout", ...(file ? ["/input.xml"] : [])]),
    cwd: "/", env: {}, fs: injected, signal: new AbortController().signal, stdin: source,
    stdout: { async write() { assert.fail("--noout must not emit XML"); } },
    stderr: { async write(bytes) { diagnostics += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 5, diagnostics);
  assert.equal(closed, true);
});
