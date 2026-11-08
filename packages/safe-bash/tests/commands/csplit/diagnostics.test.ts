import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { csplitCommands } from "../../../src/commands/csplit/index.js";

for (const [locale, argument, diagnostic] of [
  ["C", "a'b", "'a\\'b'"], ["C", "a\\b", "'a\\\\b'"], ["C", "a\tb", "'a\\tb'"],
  ["C", "é", "'\\303\\251'"], ["C.UTF-8", "é", "‘é’"], ["C.UTF-8", "a\\b", "‘a\\\\b’"],
] as const) test(`native diagnostic quote ${locale} ${JSON.stringify(argument)}`, async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: locale } }).use(csplitCommands());
  try {
    const result = await shell.exec(`csplit - '${argument.split("'").join("'\\''")}'`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `csplit: ${diagnostic}: invalid pattern\n`);
  } finally { await shell.dispose(); }
});

test("native output-open diagnostic identifies the attempted filename", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(csplitCommands());
  try {
    const result = await shell.exec("csplit -fmissing/out - 2");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "csplit: missing/out00: No such file or directory\n");
  } finally { await shell.dispose(); }
});
