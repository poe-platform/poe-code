import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("agentCommands executes the reported portable command set after Buffer is deleted", async () => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";', { removeBuffer: true });
  const fs = new core.MemoryFileSystem();
  for (const [path, contents] of Object.entries({
    '/in.txt': 'alice\nbob\n', '/in2.txt': 'alice\ncarol\n',
    '/in.json': '{"a":2}', '/in.html': '<p>hello</p>',
    '/data.txt': 'alpha:line_1:value_1\n'.repeat(30),
  })) await fs.writeFile(path, new TextEncoder().encode(contents));
  const internalErrors: unknown[] = [];
  const shell = new core.Shell({ fs, onInternalError(error) { internalErrors.push(error); } }).use(core.agentCommands());
  shell.use(core.yqCommands({ replace: true }));
  shell.use(core.xzCommands({ replace: true }));
  shell.use(core.exiftoolCommands({ replace: true }));
  shell.use(core.networkCommands({
    authorize: ({ url }) => url === "https://example.test/data",
    async transport(request) {
      assert.equal(request.method, "POST");
      const chunks: number[] = [];
      for await (const chunk of request.body!) chunks.push(...chunk);
      assert.deepEqual(chunks, [...new TextEncoder().encode("alice\nbob\n")]);
      return {
        status: 200, statusText: "OK", headers: [],
        body: (async function* () { yield Uint8Array.of(0, 128, 255); })(),
        async dispose() {},
      };
    },
  }));
  try {
    for (const script of [
      'uniq /in.txt', 'paste /in.txt /in.txt', 'join /in.txt /in.txt',
      'nl /in.txt', 'fold -w 5 /in.txt', 'expand /in.txt', 'comm /in.txt /in.txt',
      "sed 's/alice/ALICE/' /in.txt", "awk '{ print $1 }' /in.txt", 'rg alice /in.txt',
      'jq .a /in.json', 'tar -cf /out.tar /in.txt', 'zip /out.zip /in.txt',
      'column -t /in.txt', 'html-to-markdown /in.html', 'expr 2 + 2',
      'file /in.txt', 'tree /', 'du --apparent-size /in.txt',
    ]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    }
    for (const [script, stdout] of [
      ["awk -F: '/^alpha:/ { c++ } END { print c }' /data.txt", "30\n"],
      ["sed 's/^alpha:/BETA:/g; s/:line_/:LINE_/g' /data.txt", "BETA:LINE_1:value_1\n".repeat(30)],
      ["rg -c alpha /data.txt", "30\n"],
      ["jq -c '.a' /in.json", "2\n"],
      ["printf 'a: 2\n' | yq .a -o json -c", "2\n"],
      ["tar -czf /out.tar.gz -C / in.txt; tar -xOzf /out.tar.gz", "alice\nbob\n"],
      ["gzip -c /in.txt | gzip -dc", "alice\nbob\n"],
      ["xz -c /in.txt | xz -dc", "alice\nbob\n"],
      ["unzip -p /out.zip", "alice\nbob\n"],
      ["stat -c %s /in.txt", "10\n"],
      ["find /in.txt -type f", "/in.txt\n"],
      ["seq 1 3", "1\n2\n3\n"],
      ["tac /in.txt", "bob\nalice\n"],
      ["date -u -d @0 +%Y-%m-%d", "1970-01-01\n"],
      ["mktemp /tmp.XXXXXX >/dev/null", ""],
    ]) {
      const result = await shell.exec(script!);
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
      assert.equal(result.stderr, "", script);
      assert.equal(result.stdout, stdout, script);
    }
    const download = await shell.exec("curl -sS --data-binary @/in.txt https://example.test/data -o /download.bin");
    assert.equal(download.exitCode, 0, download.stderr);
    assert.deepEqual([...await fs.readFile("/download.bin")], [0, 128, 255]);
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="), char => char.charCodeAt(0));
    await fs.writeFile("/pixel.png", png);
    const metadata = await shell.exec("exiftool -s3 -ImageWidth /pixel.png");
    assert.equal(metadata.exitCode, 0, metadata.stderr);
    assert.equal(metadata.stdout, "1\n");
    await fs.writeFile("/f.txt", new TextEncoder().encode("alpha\n"));
    for (const [script, stdout] of [
      ["[[ a < b ]] && echo ordered", "ordered\n"],
      ["echo pre{1..3}post", "pre1post pre2post pre3post\n"],
      ["printf '%s' $'\\xff' | wc -c", "1\n"],
      ["rg -r REPL alpha /f.txt", "REPL\n"],
    ]) {
      const result = await shell.exec(script!, { limits: { maxExpansionBytes: 4096 } });
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
      assert.equal(result.stdout, stdout, script);
      assert.equal(result.stderr, "", script);
    }
    const search = await shell.exec("rg --json alpha /f.txt");
    assert.equal(search.exitCode, 0, search.stderr);
    const match = search.stdout.trim().split("\n").map(line => JSON.parse(line)).find(event => event.type === "match");
    assert.equal(match.data.lines.text, "alpha\n");
    const patch = await shell.exec("apply_patch", { stdin: "*** Begin Patch\n*** Update File: /f.txt\n@@\n-alpha\n+beta\n*** End Patch\n" });
    assert.equal(patch.exitCode, 0, patch.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/f.txt")), "beta\n");
    const trap = await shell.exec('trap "echo bye" EXIT; trap -p');
    assert.equal(trap.exitCode, 0, trap.stderr);
    assert.ok(trap.stdout.includes("echo bye"));
    assert.ok(trap.stdout.endsWith("bye\n"));
    assert.equal((await shell.exec("trap - EXIT")).exitCode, 0);
    const diff = await shell.exec('diff -u /in.txt /in2.txt');
    assert.equal(diff.exitCode, 1, diff.stderr);
    assert.ok(diff.stdout.includes('-bob\n+carol\n'));
    assert.equal(diff.stderr, '');
    assert.ok((await fs.readFile('/out.tar')).byteLength > 0);
    assert.ok((await fs.readFile('/out.zip')).byteLength > 0);
    assert.deepEqual(internalErrors, []);
  } finally { await shell.dispose(); }
});

test("core imports and executes commands without a host Buffer", async () => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";');
  const fs = new core.MemoryFileSystem();
  await fs.writeFile("/a.txt", new TextEncoder().encode("hello\nworld\n"));
  await fs.writeFile("/b.txt", new TextEncoder().encode("hello\nthere\n"));
  const shell = new core.Shell({ fs, commands: new core.CommandRegistry([
    ...core.createStandardCommands(), ...core.createStreamFormatCommands(),
    ...core.createDiffPatchCommands(), ...core.createDuCommands(),
    ...core.createTreeCommands(), ...core.createTextProgramCommands(),
    ...core.createSearchCommands(),
  ]) });
  try {
    for (const [script, output] of [
      ['printf -v x "%04d" 7; echo "$x"', "0007\n"],
      ["awk '{ print $1 }' /a.txt", "hello\nworld\n"],
      ["sed 's/hello/hi/' /a.txt", "hi\nworld\n"],
      ["grep hello /a.txt", "hello\n"],
      ["rg '(?<word>hello)' -r '$word/$1/$$' /a.txt", "hello/hello/$\n"],
      ["printf hello | tr a-z A-Z", "HELLO"],
      ["printf hello | xargs echo", "hello\n"],
    ]) {
      const result = await shell.exec(script!, { limits: { maxExpansionBytes: 4096 } });
      assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
      assert.equal(result.stderr, "", script);
      assert.equal(result.stdout, output, script);
    }
    const diff = await shell.exec("diff -u /a.txt /b.txt");
    assert.equal(diff.exitCode, 1, diff.stderr);
    assert.equal(diff.stderr, "");
    assert.ok(diff.stdout.includes("-world\n+there\n"));
    const patch = await shell.exec("patch /a.txt", { stdin: diff.stdout });
    assert.equal(patch.exitCode, 0, patch.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/a.txt")), "hello\nthere\n");
    const allocation = await shell.exec("du /a.txt");
    assert.equal(allocation.exitCode, 1);
    assert.equal(allocation.stderr, 'du: "/a.txt": allocated bytes unknown; total suppressed\n');
    for (const script of ["du --apparent-size /a.txt", "tree /"]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.includes("a.txt"));
    }
  } finally { await shell.dispose(); }
});

test("custom plugins execute multi-command scripts and enforce UTF-8 source limits without Node globals", async () => {
  const { api: core } = await portableRuntime('export * from "./packages/safe-bash/src/core.browser.ts";');
  const fs = new core.MemoryFileSystem();
  await fs.mkdir("/workspace", { recursive: true });
  const commands: string[] = [];
  const shell = new core.Shell({ fs, cwd: "/workspace" }).use(core.standardCommands()).use({
    name: "observe-commands",
    setup(host) {
      host.use(async (context, next) => {
        commands.push(context.command);
        return next();
      });
    },
  });
  try {
    const result = await shell.exec("echo a; echo b");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "a\nb\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(commands, ["echo", "echo"]);

    const source = "echo é; echo 😀";
    const maxSourceBytes = new TextEncoder().encode(source).byteLength;
    const accepted = await shell.exec(source, { limits: { maxSourceBytes } });
    assert.equal(accepted.exitCode, 0, accepted.stderr);
    assert.equal(accepted.stdout, "é\n😀\n");
    await assert.rejects(
      shell.exec(source, { limits: { maxSourceBytes: maxSourceBytes - 1 } }),
      { name: "ShellLimitError", message: "Shell limit exceeded: maxSourceBytes" },
    );
    assert.deepEqual(commands, ["echo", "echo", "echo", "echo"]);
  } finally { await shell.dispose(); }
});
