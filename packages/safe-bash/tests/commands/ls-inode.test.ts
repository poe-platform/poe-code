import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRealFileSystem } from "../../src/fs/real/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { fixture, run } from "./helpers.js";

for (const option of ["-1i", "-1 --inode"]) {
  test(`ls ${option} lists observed rooted-real inode numbers`, async context => {
    const root = fileURLToPath(new URL("./", import.meta.url));
    const fs = await createRealFileSystem({ root });
    const shell = new Shell({ fs, cwd: "/" }).use(agentCommands());
    context.after(() => shell.dispose());
    const observed = await stat(new URL("./ls-inode.test.ts", import.meta.url));
    const result = await shell.exec(`ls ${option} ls-inode.test.ts`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${observed.ino} ls-inode.test.ts\n`);
  });
}

test("ls inode output preserves link identity and dereference selection", async () => {
  const fs = await fixture({ file: "value" });
  await fs.link("/work/file", "/work/hard");
  await fs.symlink("file", "/work/soft");
  const inode = (await fs.stat("/work/file")).ino;
  const linkInode = (await fs.lstat("/work/soft")).ino;
  const result = await run("ls", ["-i", "file", "hard", "soft"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, `${inode} file\n${inode} hard\n${linkInode} soft\n`);
  assert.equal((await run("ls", ["-iL", "soft"], { fs })).stdout, `${inode} soft\n`);
  const long = await run("ls", ["-li", "file"], { fs });
  assert.equal(long.exitCode, 0, long.stderr);
  assert.ok(long.stdout.startsWith(`${inode} -`));
});

test("ls inode listing leaves missing provider metadata unknown", async () => {
  const fs = await fixture({ "owned/first": "one", "owned/second": "two" });
  const lstat = fs.lstat.bind(fs);
  fs.lstat = async (...args) => {
    const { ino, identityScope, ...metadata } = await lstat(...args);
    return metadata;
  };
  const result = await run("ls", ["--inode", "owned"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "? first\n? second\n");
});
