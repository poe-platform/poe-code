import assert from "node:assert/strict";
import test from "node:test";
import { grepCommands } from "../../../src/commands/grep.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

test("grep supports -I, -T, --binary-files=without-match, -NUM, and option override ordering", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a.txt", Buffer.from("foo\nbar\nbaz\nqux\nfoo\n"));
  await fs.writeFile("/bin.dat", Buffer.from([102, 111, 111, 0, 10]));
  await fs.mkdir("/sub", { recursive: true });
  await fs.writeFile("/sub/c.txt", Buffer.from("foo\n"));
  const shell = new Shell({ fs, cwd: "/" });
  for (const command of grepCommands()) shell.register(command);
  try {
    const r1 = await shell.exec("grep -I foo a.txt bin.dat");
    assert.equal(r1.exitCode, 0);
    assert.equal(r1.stdout, "a.txt:foo\na.txt:foo\n");

    const r2 = await shell.exec("grep -T -n foo a.txt");
    assert.equal(r2.exitCode, 0);
    assert.equal(r2.stdout, "1:\tfoo\n5:\tfoo\n");

    const r3 = await shell.exec("grep -h -H foo a.txt");
    assert.equal(r3.exitCode, 0);
    assert.equal(r3.stdout, "a.txt:foo\na.txt:foo\n");

    const r4 = await shell.exec("grep --no-ignore-case -i FOO a.txt");
    assert.equal(r4.exitCode, 0);
    assert.equal(r4.stdout, "foo\nfoo\n");

    const r5 = await shell.exec("grep -1 bar a.txt");
    assert.equal(r5.exitCode, 0);
    assert.equal(r5.stdout, "foo\nbar\nbaz\n");

    const r6 = await shell.exec("grep -d skip -r foo sub");
    assert.equal(r6.exitCode, 0);
    assert.equal(r6.stdout, "sub/c.txt:foo\n");
  } finally {
    await shell.dispose();
  }
});
