import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { grepCommands } from "../../src/commands/grep.js";
import { printfCommand } from "../../src/commands/basic.js";

test("grep help teaches portable alternation and safe verification retries", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  for (const command of grepCommands()) shell.register(command);
  try {
    const result = await shell.exec("grep --help");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("BRE groups, intervals, backreferences and escape extensions"));
    assert.ok(result.stdout.includes("grep -E 'Remove upvote|Upvoted'"));
    assert.ok(result.stdout.includes("retry only the read-only verification"));
  } finally { await shell.dispose(); }
});

test("failed context verification leaves a successful mutation applied exactly once", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  for (const command of [...grepCommands(), printfCommand]) shell.register(command);
  try {
    const result = await shell.exec("printf 'clicked\\n' >> /actions && printf 'Upvoted\\n' | grep -A4 -B2 -m1 'Remove upvote\\|Upvoted'");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("unsupported"));
    const verification = await shell.exec("printf 'Upvoted\\n' | grep -E -A4 -B2 -m1 'Remove upvote|Upvoted'");
    assert.equal(verification.exitCode, 0, verification.stderr);
    assert.equal(verification.stdout, "Upvoted\n");
    assert.equal(Buffer.from(await fs.readFile("/actions")).toString(), "clicked\n");
  } finally { await shell.dispose(); }
});
