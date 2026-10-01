import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";

test("alternating tenants never replay another filesystem's pipeline output", async () => {
  const tenants = await Promise.all(["ALPHA", "BRAVO"].map(async secret => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data.txt", new TextEncoder().encode(`foo:${secret}\n${"x".repeat(1200)}\n`));
    return { fs, secret, shell: new Shell({ fs }).use(standardCommands()) };
  }));
  try {
    for (let round = 0; round < 4; round++) for (const { shell, secret } of tenants) {
      await shell.exec("");
      const result = await shell.exec("grep foo /data.txt | cut -d: -f2 | sort");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `${secret}\n`);
    }
    await tenants[0]!.fs.writeFile("/data.txt", new TextEncoder().encode(`foo:CHANGED\n${"x".repeat(1200)}\n`));
    assert.equal((await tenants[0]!.shell.exec("grep foo /data.txt | cut -d: -f2 | sort")).stdout, "CHANGED\n");
  } finally {
    await Promise.all(tenants.map(({ shell }) => shell.dispose()));
  }
});

test("find pipelines observe middle entry mutations and separate filesystems", async () => {
  const tenants = await Promise.all([32, 2].map(async count => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/data");
    for (let i = 0; i < 32; i++) await fs.writeFile(`/data/${i === 0 || i === 31 || i < count - 1 ? "match" : "other"}${i}`, new Uint8Array());
    return { fs, count, shell: new Shell({ fs }).use(standardCommands()) };
  }));
  try {
    const command = "find /data -name 'match*' | wc -l";
    for (let round = 0; round < 3; round++) for (const { shell, count } of tenants) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.trim(), String(count));
    }
    await tenants[0]!.fs.rename("/data/match10", "/data/other10");
    assert.equal((await tenants[0]!.shell.exec(command)).stdout.trim(), "31");
  } finally {
    await Promise.all(tenants.map(({ shell }) => shell.dispose()));
  }
});
