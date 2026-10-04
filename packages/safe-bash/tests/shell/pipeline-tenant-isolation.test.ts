import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { agentCommands } from "../../src/core.js";

test("alternating tenants never replay another filesystem's pipeline output", async () => {
  const tenants = await Promise.all(["ALPHA", "BRAVO"].map(async secret => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data.txt", new TextEncoder().encode(`foo:${secret}\n${secret === "BRAVO" ? "bar:ONLY_BRAVO\n" : ""}${"x".repeat(1200)}\n`));
    return { fs, secret, shell: new Shell({ fs }).use(standardCommands()) };
  }));
  try {
    for (let round = 0; round < 4; round++) for (const { shell, secret } of tenants) {
      await shell.exec("");
      const result = await shell.exec("grep foo /data.txt | cut -d: -f2 | sort");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `${secret}\n`);
    }
    for (let round = 0; round < 3; round++) {
      await tenants[1]!.shell.exec("");
      const bravo = await tenants[1]!.shell.exec("grep bar /data.txt | cut -d: -f2 | sort");
      assert.equal(bravo.stdout, "ONLY_BRAVO\n");
      await tenants[0]!.shell.exec("");
      const alpha = await tenants[0]!.shell.exec("grep bar /data.txt | cut -d: -f2 | sort");
      assert.equal(alpha.stdout, "");
      assert.equal(alpha.exitCode, 0);
    }
    await tenants[0]!.fs.writeFile("/data.txt", new TextEncoder().encode(`foo:CHANGED\n${"x".repeat(1200)}\n`));
    assert.equal((await tenants[0]!.shell.exec("grep foo /data.txt | cut -d: -f2 | sort")).stdout, "CHANGED\n");
  } finally {
    await Promise.all(tenants.map(({ shell }) => shell.dispose()));
  }
});

for (const stages of ["sort | wc -c", "sort | cat | wc -c"]) {
  for (const changePipeline of [false, true]) {
    test(`pipeline byte counts follow distinct sources and ASTs (${stages}, change=${changePipeline})`, async context => {
      const encoder = new TextEncoder();
      const shells = await Promise.all([
        "alpha:1\n".repeat(200),
        "alpha:1\n".repeat(50) + "beta:2\n".repeat(150),
      ].map(async content => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/data.txt", encoder.encode(content));
        const shell = new Shell({ fs }).use(agentCommands());
        context.after(() => shell.dispose());
        return shell;
      }));
      const first = `grep alpha /data.txt | ${stages}`;
      const next = changePipeline ? `grep beta /data.txt | ${stages}` : first;
      // Keep each filesystem and its original file alive throughout A-B-A.
      // Changing the pipeline must not associate an earlier source with newer output.
      for (const [tenant, command, expected] of [
        [0, first, "1600\n"],
        [1, next, changePipeline ? "1050\n" : "400\n"],
        [0, next, changePipeline ? "0\n" : "1600\n"],
        [0, next, changePipeline ? "0\n" : "1600\n"],
      ] as const) {
        const result = await shells[tenant]!.exec(command);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
        assert.deepEqual(result.stdoutBytes, encoder.encode(expected));
      }
    });
  }
}

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

for (const [pipeline, expected] of [
  ["head -n 5", "/work/a.txt\n/work/sub/c.txt\n"],
  ["head -n 1", "/work/a.txt\n"],
  ["head -n 5 | wc -l", "2\n"],
] as const) {
  test(`recursive find completes downstream stages: ${pipeline}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work/sub", { recursive: true });
    await fs.writeFile("/work/a.txt", new TextEncoder().encode("alpha:1\n"));
    await fs.writeFile("/work/sub/c.txt", new TextEncoder().encode("alpha:2\n"));
    const shell = new Shell({ fs }).use(agentCommands());
    context.after(() => shell.dispose());
    for (let run = 0; run < 3; run++) {
      const result = await shell.exec(`find /work -name '*.txt' | ${pipeline}`);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    }
  });
}

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

test("repeated find and grep pipelines enforce byte and filesystem limits", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir/sub/nested", { recursive: true });
  for (let i = 0; i < 31; i++) {
    await fs.writeFile(`/dir/sub/f${String(i).padStart(2, "0")}.txt`, new Uint8Array());
  }
  await fs.writeFile("/dir/sub/nested/extra.txt", new Uint8Array());
  await fs.writeFile("/data.txt", new TextEncoder().encode("match:value\n".repeat(128)));
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  const find = "find /dir/sub -name '*.txt' | wc -l";
  for (let run = 0; run < 3; run++) {
    assert.equal((await shell.exec(find)).stdout, "32\n");
    await assert.rejects(shell.exec(find, { limits: { maxPipelineBytes: 5 } }), /maxPipelineBytes/);
    await assert.rejects(shell.exec(find, { limits: { maxFileSystemOperations: 1 } }), /maxFileSystemOperations/);
    const grep = "grep match /data.txt | cut -d: -f2 | sort";
    assert.equal((await shell.exec(grep)).stdout, "value\n".repeat(128));
    await assert.rejects(shell.exec(grep, { limits: { maxPipelineBytes: 5 } }), /maxPipelineBytes/);
    await assert.rejects(shell.exec(grep, { limits: { maxFileSystemOperations: 0 } }), /maxFileSystemOperations/);
  }
  for (let i = 0; i < 10; i++) await fs.writeFile(`/dir/sub/nested/more_${i}.txt`, new Uint8Array());
  assert.equal((await shell.exec(find)).stdout, "42\n");
  await fs.rm("/dir/sub/nested/extra.txt");
  assert.equal((await shell.exec(find)).stdout, "41\n");
});

for (const [command, bytes, output] of [
  ["printf abc | cat", 3, "abc"],
  ["printf abc | cat | cat", 6, "abc"],
  ["printf abc | cat; printf de | cat", 5, "abcde"],
  ["for i in 1 2; do printf abc | cat; done", 6, "abcabc"],
  ['echo "$(printf abc | cat)"', 3, "abc\n"],
  ["(printf abc >&2) |& cat", 3, "abc"],
  ["printf abc | cat > /out; cat /out", 3, "abc"],
] as const) test(`pipeline byte limit charges every edge: ${command}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  for (let run = 0; run < 2; run++) {
    const result = await shell.exec(command, { limits: { maxPipelineBytes: bytes } });
    assert.equal(result.stdout, output);
    assert.equal(result.exitCode, 0, result.stderr);
    await assert.rejects(shell.exec(command, { limits: { maxPipelineBytes: bytes - 1 } }), /maxPipelineBytes/);
  }
  // Terminal output consumes no pipeline quota; each exec starts a fresh ledger.
  assert.equal((await shell.exec("printf abc", { limits: { maxPipelineBytes: 0 } })).stdout, "abc");
});

for (const path of ["/large.txt", "/dir/large.txt"]) {
  for (const count of [8, 8192]) {
    for (const flag of ["-l", "-c"]) test(`pipeline preserves all stages: ${path}, ${count} lines, ${flag}`, async context => {
      const fs = new MemoryFileSystem();
      await fs.mkdir("/dir");
      const content = "match:value\n".repeat(count);
      await fs.writeFile(path, new TextEncoder().encode(content));
      const shell = new Shell({ fs }).use(standardCommands());
      context.after(() => shell.dispose());
      const command = `grep match ${path} | sort | wc ${flag}`;
      for (let run = 0; run < 2; run++) {
        await shell.exec("");
        const result = await shell.exec(command);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, `${flag === "-l" ? count : content.length}\n`);
      }
      await shell.exec("");
      await assert.rejects(shell.exec(command, { limits: { maxOutputBytes: 100 } }), /maxOutputBytes/);
    });
  }
}

for (const flag of ["-l", "-c"]) test(`warmed wc ${flag} enforces input admission`, async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/file", new Uint8Array());
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  await shell.exec("");
  await assert.rejects(shell.exec(`find /dir -name '*' | wc ${flag}`, { limits: { maxInputBytes: 1 } }), /maxInputBytes/);
});

test("warmed pipelines count newlines from each byte-producing stage", async context => {
  const fs = new MemoryFileSystem();
  const encoder = new TextEncoder();
  await fs.writeFile("/data.txt", encoder.encode(Array.from({ length: 60 }, (_, i) =>
    `${i % 3 === 0 ? "alpha" : "beta"}:val_${i}\n`).join("")));
  const shell = new Shell({ fs }).use(agentCommands());
  context.after(() => shell.dispose());
  const cases = [
    ["grep '^alpha' /data.txt | cut -d: -f2 | wc -l", 20],
    ["grep alpha /data.txt | wc -l", 20],
    ["grep alpha /data.txt | cut -d: -f2 | wc -l", 20],
    ["grep alpha /data.txt | tr : '\\n' | wc -l", 40],
    ["grep alpha /data.txt | sort | wc -l", 20],
    ["grep alpha /data.txt | head -n 7 | wc -l", 7],
    ["grep alpha /data.txt | head -c 3 | wc -l", 0],
    ["grep absent /data.txt | cut -d: -f2 | wc -l", 0],
    ["grep alpha /data.txt | wc -l", 20],
  ] as const;
  for (let run = 0; run < 3; run++) {
    if (run === 1) await fs.writeFile("/data.txt", encoder.encode(Array.from({ length: 60 }, (_, i) =>
      `${i % 3 === 0 ? "alpha" : "beta"}:val_${i}\n`).join("") + "x".repeat(1200) + "\n"));
    for (const [command, expected] of cases) {
      await shell.exec("");
      const result = await shell.exec(command);
      assert.equal(result.stdout, `${expected}\n`, command);
      assert.equal(result.stderr, "", command);
      assert.equal(result.exitCode, 0, command);
    }
  }
});

test("missing grep input still executes downstream pipeline stages", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  for (let run = 0; run < 2; run++) {
    await shell.exec("");
    const result = await shell.exec("grep foo /nonexistent | wc -l");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "0\n");
    assert.match(result.stderr, /nonexistent/);
  }
});

for (const prefix of ["", "echo ready; "]) {
  for (const consumer of ["wc -l", "head -n 3"]) {
    for (const mutation of ["extensions", "names", "subdirectory"]) {
      test(`find pipeline observes recreated directory: ${prefix}${consumer}, ${mutation}`, async context => {
        const fs = new MemoryFileSystem();
        const shell = new Shell({ fs }).use(standardCommands());
        context.after(() => shell.dispose());
        const paths = Array.from({ length: 32 }, (_, index) =>
          `/work/dir/f${String(index + 1).padStart(2, "0")}.txt`);
        await fs.mkdir("/work/dir", { recursive: true });
        for (const path of paths) await fs.writeFile(path, new Uint8Array());
        const command = `${prefix}find /work/dir -name '*.txt' | ${consumer}`;
        const check = async (matches: string[]) => {
          for (let run = 0; run < 3; run++) {
            await shell.exec("");
            const result = await shell.exec(command);
            const output = consumer === "wc -l" ? `${matches.length}\n` : `${matches.toSorted().slice(0, 3).join("\n")}\n`;
            assert.equal(result.stdout, `${prefix ? "ready\n" : ""}${output}`);
            assert.equal(result.stderr, "");
            assert.equal(result.exitCode, 0);
          }
        };
        await check(paths);
        await fs.rm("/work/dir", { recursive: true });
        await fs.mkdir("/work/dir");
        const matches: string[] = [];
        for (let index = 0; index < paths.length; index++) {
          let path = paths[index]!;
          if (index > 0 && index < paths.length - 1) {
            if (mutation === "extensions") path = path.slice(0, -3) + "log";
            if (mutation === "names") path = path.replace("/f", "/g");
          }
          if (mutation === "subdirectory" && index === 1) {
            await fs.mkdir(path);
            matches.push(path);
            path += "/nested.txt";
          }
          await fs.writeFile(path, new Uint8Array());
          if (path.endsWith(".txt")) matches.push(path);
        }
        await check(matches);
        if (mutation === "subdirectory") {
          const nested = `${paths[1]}/another.txt`;
          await fs.writeFile(nested, new Uint8Array());
          matches.push(nested);
          await check(matches);
        }
      });
    }
  }
}

test("find pipeline observes directory recreation by shell write batches", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  for (const extension of ["txt", "log", "txt"]) {
    const writes = Array.from({ length: 32 }, (_, index) =>
      `echo x > /work/dir/f${String(index + 1).padStart(2, "0")}.${index === 0 || index === 31 ? "txt" : extension}`);
    const setup = await shell.exec(`rm -rf /work/dir; mkdir -p /work/dir\n${writes.join("\n")}`);
    assert.equal(setup.exitCode, 0, setup.stderr);
    await shell.exec("");
    for (let run = 0; run < 3; run++) {
      const result = await shell.exec('find /work/dir -name "*.txt" | wc -l');
      assert.equal(result.stdout, extension === "txt" ? "32\n" : "2\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    }
  }
});
