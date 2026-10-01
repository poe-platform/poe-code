import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { agentCommands } from "../../src/core.js";

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

test("pipeline output follows A-B-A source buffer reuse", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  const encoder = new TextEncoder();
  const a = encoder.encode(`match:SECRET_A\n${"x\n".repeat(600)}`);
  const b = encoder.encode(`match:SECRET_B\n${"y\n".repeat(600)}`);
  for (const [bytes, expected] of [[a, "SECRET_A\n"], [b, "SECRET_B\n"], [a, "SECRET_A\n"]] as const) {
    await fs.writeFile("/data.txt", bytes);
    await shell.exec("");
    const result = await shell.exec("grep match /data.txt | cut -d: -f2 | sort");
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    await fs.rm("/data.txt");
  }
});

for (const content of ["match:café\n", "match:value\n".repeat(4096)]) {
  test(`grep fallback preserves pipeline stages and filesystem accounting (${content.length} characters)`, async context => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data.txt", new TextEncoder().encode(content));
    const shell = new Shell({ fs, limits: { maxFileSystemOperations: 1 } }).use(standardCommands());
    context.after(() => shell.dispose());
    for (let run = 0; run < 3; run++) {
      const direct = await shell.exec("grep match /data.txt");
      assert.equal(direct.stdout, content);
      assert.equal(direct.stderr, "");
      assert.equal(direct.exitCode, 0);
      await shell.exec("");
      const result = await shell.exec("grep match /data.txt | cut -d: -f2 | sort");
      assert.equal(result.stdout, content.split("match:").join(""));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    }
    await assert.rejects(shell.exec("grep match /data.txt", { limits: { maxFileSystemOperations: 0 } }), /maxFileSystemOperations/);
  });
}

test("recursive find pipelines continue after asynchronous traversal", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/sub/dir/z_nested", { recursive: true });
  await fs.writeFile("/sub/dir/a.ts", new Uint8Array());
  await fs.writeFile("/sub/dir/z_nested/b.ts", new Uint8Array());
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  for (let run = 0; run < 3; run++) {
    await shell.exec("");
    const result = await shell.exec('find /sub/dir -name "*.ts" | wc -l');
    assert.equal(result.stdout.trim(), "2");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  }
});

test("repeated command execution preserves complete patterns, AWK context and strict jq booleans", async context => {
  const fs = new MemoryFileSystem();
  const encoder = new TextEncoder();
  await fs.mkdir("/rgdir");
  await fs.writeFile("/rgdir/item.txt", encoder.encode("foobar\n"));
  const data = encoder.encode(`a:b:10\n${"x:y:20\n".repeat(100)}`);
  await fs.writeFile("/data.txt", data);
  await fs.writeFile("/copy.txt", data);
  await fs.writeFile("/in.jsonl", encoder.encode([0, 1, "false", "true", true, false, null].map((ok, a) => JSON.stringify({ ok, a })).join("\n") + "\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  context.after(() => shell.dispose());
  for (let run = 0; run < 3; run++) {
    for (const [command, expected, status] of [
      ["rg -c foobar /rgdir", "/rgdir/item.txt:1\n", 0],
      ["rg -c fXXXXr /rgdir", "", 1],
      ["awk -F: '{ cnt++ } END { print cnt }' /data.txt", "101\n", 0],
      [String.raw`SECRET=tenant_A awk -F: '{ cnt++ } END { printf "%s %s %d\n", ENVIRON["SECRET"], FILENAME, cnt }' /data.txt`, "tenant_A /data.txt 101\n", 0],
      [String.raw`SECRET=tenant_B awk -F: '{ cnt++ } END { printf "%s %s %d\n", ENVIRON["SECRET"], FILENAME, cnt }' /copy.txt`, "tenant_B /copy.txt 101\n", 0],
      [`awk -F: '{ cnt++ } END { print cnt > "/result" }' /data.txt; cat /result; rm /result`, "101\n", 0],
      [`jq -c 'select(.ok == true) | {a}' /in.jsonl`, '{"a":4}\n', 0],
      [`jq -c 'select(.ok) | {a}' /in.jsonl`, '{"a":0}\n{"a":1}\n{"a":2}\n{"a":3}\n{"a":4}\n', 0],
    ] as const) {
      await shell.exec("");
      const result = await shell.exec(command);
      assert.equal(result.stdout, expected, command);
      assert.equal(result.stderr, "", command);
      assert.equal(result.exitCode, status, command);
    }
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
