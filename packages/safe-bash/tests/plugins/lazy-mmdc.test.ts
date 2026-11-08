import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem, mmdcCommands } from "../../src/core.js";

test("core Mermaid plugins snapshot options and retain array registration and PDF output", async () => {
  const settings = { limits: { maxSourceBytes: 4096 } };
  const plugin = mmdcCommands(settings);
  assert.equal(Array.isArray(plugin), true);
  assert.equal(plugin[0]?.name, "mmdc");
  assert.equal(Object.isFrozen(plugin), true);
  settings.limits.maxSourceBytes = 1;
  const fs = createMemoryFileSystem();
  await fs.writeFile("/diagram.mmd", new TextEncoder().encode("graph LR; A-->B"));
  const shell = new Shell({ fs }).use(plugin);
  try {
    const result = await shell.exec("mmdc -i /diagram.mmd -o /diagram.pdf");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode((await fs.readFile("/diagram.pdf")).subarray(0, 8)), "%PDF-1.7");
  } finally { await shell.dispose(); }
});

test("core Mermaid plugins validate limits before the first invocation", () => {
  assert.throws(() => mmdcCommands({ limits: { maxSourceBytes: -1 } }));
});
