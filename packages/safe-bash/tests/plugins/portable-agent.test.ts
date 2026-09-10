import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as browser from "../../src/index.js";
import { agentCommands, createAgentCommands } from "../../src/index.js";
import { RegexExecutor } from "../../src/commands/regex-execution/portable.js";

const expected = [
  "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
  "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
  "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find", "cmp", "fmt", "shuf", "numfmt",
  "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha512sum", "sha384sum", "sha256sum", "sha224sum", "sha1sum",
  "md5sum", "cksum", "gzip", "gunzip", "zcat", "bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "zstd", "unzstd", "zstdcat", "diff", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "zip", "unzip",
  "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
  "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint", "csplit", "pr", "tsort", "factor",
].sort();

const portableFamilyCases = [
  ["basic", "printf 'ok\\n'", "ok\n"],
  ["filesystem", "mkdir /files && printf hi > /files/a && cp /files/a /files/b && cat /files/b", "hi"],
  ["streams", "printf 'first\\nsecond\\n' | head -n 1", "first\n"],
  ["text", "printf 'b\\na\\n' | sort | cut -c 1", "a\nb\n"],
  ["predicates", "test 2 -gt 1 && echo yes", "yes\n"],
  ["execution", "env printf 'env\\n'", "env\n"],
  ["execution-xargs", "printf '\"1+1\"' | xargs jq -nc", "2\n"],
  ["find", "printf text > /input && find /input -type f", "/input\n"],
  ["text-programs", "printf 'hello\\n' | sed 's/hello/world/' | awk '{print $1}'", "world\n"],
  ["structured", "jq -nc '1+1'", "2\n"],
  ["search", "printf 'aa\\nbb\\n' | rg -F aa", "aa\n"],
  ["grep", "printf 'aa\\nbb\\n' | grep -E 'a+'", "aa\n"],
  ["grep-aliases", "printf 'aa\\nbb\\n' | egrep 'a+' | fgrep aa", "aa\n"],
  ["bytes-encoding", "printf abc | base64 | base64 -d", "abc"],
  ["bytes-checksums", "printf abc | sha256sum", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\n"],
  ["bytes-compression", "printf 'compressed\\n' | gzip -c | gunzip -c", "compressed\n"],
  ["diff-patch", "printf 'before\\n' > /old && printf 'after\\n' > /new && diff -u /old /new | patch -s /old && cat /old", "after\n"],
  ["metadata", "printf x > /mode && chmod 600 /mode && stat -c '%a' /mode", "600\n"],
  ["archive", "mkdir /archive-in /archive-out && printf payload > /archive-in/item && tar -cf - -C /archive-in item | tar -xf - -C /archive-out && cat /archive-out/item", "payload"],
  ["table-text", "printf 'a\\nb\\n' | paste -sd, -", "a,b\n"],
  ["stream-inspection", "printf 'a\\nb\\n' | tac", "b\na\n"],
  ["stream-format", "seq 2 3", "2\n3\n"],
  ["split", "printf abcd | split -b 2 - /piece- && cat /piece-aa /piece-ab", "abcd"],
  ["time-env", "env PORTABLE=value printenv PORTABLE", "value\n"],
  ["tree", "mkdir /tree && touch /tree/item && tree -if --noreport /tree", "/tree\n/tree/item\n"],
  ["file", "printf 'plain text\\n' > /plain && file -bi /plain", "text/plain; charset=us-ascii\n"],
  ["column", "printf 'a b\\nc d\\n' | column -t", "a  b\nc  d\n"],
  ["html-to-markdown", "printf '<h1>Hello</h1>' | html-to-markdown", "# Hello\n"],
  ["du", "printf abc > /size && du -b /size", "3\t/size\n"],
  ["expr", "expr 2 + 3", "5\n"],
  ["which", "mkdir /tools && printf x > /tools/run && chmod +x /tools/run && env PATH=/tools which run", "/tools/run\n"],
  ["timeout", "timeout 1 echo done", "done\n"],
  ["apply-patch", "printf '%s\\n' '*** Begin Patch' '*** Add File: /added' '+ready' '*** End Patch' | apply_patch && cat /added", "Success. Updated the following files:\nA /added\nready\n"],
] as const;

for (const [family, source, stdout] of portableFamilyCases) {
  test(`portable family ${family} executes its VFS workflow`, async () => {
    const shell = new browser.Shell({ fs: new browser.MemoryFileSystem() }).use(agentCommands({ regexExecutor: browser.createBoundedRegexProvider() }));
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, `${family}: ${result.stderr}`);
      assert.equal(result.stdout, stdout, family);
      assert.equal(result.stderr, "", family);
    } finally { await shell.dispose(); }
  });
}

for (const kind of ["definitions", "plugin"] as const) {
  test(`Default ${kind} share general regex pools without creating workers`, async context => {
    const opened: RegexExecutor[] = [];
    const stopped = new Error("stop before worker acquisition");
    context.mock.method(RegexExecutor.prototype, "open", function (this: RegexExecutor) {
      opened.push(this);
      throw stopped;
    });
    const options = { regex: { maxWorkers: 1 }, search: { regex: { maxWorkers: 3 } } };
    const commands = new browser.CommandRegistry(kind === "definitions" ? createAgentCommands(options) : []);
    if (kind === "plugin") await agentCommands(options).setup({ commands, use() {}, registerFileSystem() {} });
    for (const command of ["grep", "egrep", "fgrep", "expr", "rg"]) {
      await assert.rejects(async () => commands.get(command)!.execute({
        command, args: ["a"], stdin: browser.toByteSource("a\n"),
        stdout: { async write() {} }, stderr: { async write() {} },
        fs: new browser.MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
      }), error => error === stopped);
    }
    assert.equal(opened.length, 5);
    const [grep, egrep, fgrep, expr, search] = opened;
    assert.equal(egrep, fgrep, "aliases share the general family pool");
    assert.equal(grep, egrep);
    assert.equal(grep, expr);
    assert.notEqual(grep, search, "explicit search policy retains its own executor");
    assert.deepEqual(opened.map(executor => executor.options.maxWorkers), [1, 1, 1, 1, 3]);
  });
}

test("complete portable agent preset accepts an omitted provider", async () => {
  assert.equal(typeof agentCommands, "function");
  const commands = new browser.CommandRegistry();
  const plugin = agentCommands({});
  await plugin.setup({ commands, use() {}, registerFileSystem() {} });
  assert.deepEqual(commands.list().map(command => command.name).sort(), expected);
  await plugin.dispose?.();
});

test("default inventory matches the independent 104 names and excludes host opt-ins", () => {
  const names = createAgentCommands().map(command => command.name);
  assert.equal(names.length, 104);
  assert.deepEqual(names.sort(), expected);
  assert.equal(new Set(names).size, 104);
});

test("portable preset graph never loads fs, native workers, or host command adapters", async () => {
  const result = await build({
    entryPoints: [new URL("../../src/plugins/index.ts", import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false, metafile: true,
    external: ["node:*", "poe-code/safe-fs/core"],
  });
  for (const [path, input] of Object.entries(result.metafile!.inputs)) {
    assert.ok(!path.includes("/commands/node/") && !path.includes("/commands/safejs/"), path);
    for (const imported of input.imports) {
      assert.ok(!["node:fs", "node:fs/promises", "node:worker_threads"].includes(imported.path), `${path}: ${imported.path}`);
    }
  }
});

test("original browser graph remains buildable without Node builtin polyfills", async () => {
  const { resolveBrowserShellBuild } = await import(new URL("../../../../scripts/bundle-safe-bash.mjs", import.meta.url).href);
  const result = await build(resolveBrowserShellBuild(fileURLToPath(new URL("../../../../", import.meta.url))));
  const outputs = result.metafile!.outputs;
  const pending = Object.keys(outputs).filter(filename => filename.endsWith("/core.browser.js"));
  assert.equal(pending.length, 1);
  const reachable = new Set<string>();
  while (pending.length) {
    const filename = pending.pop()!;
    if (reachable.has(filename)) continue;
    reachable.add(filename);
    const output = outputs[filename];
    assert.ok(output, filename);
    for (const imported of output.imports) {
      assert.ok(!imported.path.startsWith("node:"), `${filename}: ${imported.path}`);
      if (!imported.external) pending.push(imported.path);
    }
  }
});

test("portable registration is atomic and replacement preserves unrelated commands", async () => {
  const commands = new browser.CommandRegistry([{ name: "jq", execute: () => ({ exitCode: 17 }) }]);
  const host = { commands, use() {}, registerFileSystem() {} };
  const before = commands.list();
  const plugin = agentCommands({ regexExecutor: browser.createBoundedRegexProvider() });
  assert.throws(() => plugin.setup(host), /already registered: jq/);
  assert.deepEqual(commands.list(), before);
  await plugin.dispose?.();
  const invalid = agentCommands({ regexExecutor: browser.createBoundedRegexProvider(), structured: { limits: { maxSteps: 0 } } });
  assert.throws(() => invalid.setup(host), /positive/);
  assert.deepEqual(commands.list(), before);
  await invalid.dispose?.();
  commands.register({ name: "custom", execute: () => ({ exitCode: 23 }) });
  const custom = commands.get("custom");
  const replacement = agentCommands({ regexExecutor: browser.createBoundedRegexProvider(), replace: true });
  await replacement.setup(host);
  assert.equal(commands.list().length, 105);
  assert.equal(commands.get("custom"), custom);
  await replacement.dispose?.();
  assert.throws(() => replacement.setup(host), /disposed/);
});

test("all regex consumers use the injected provider and retire their workers", async () => {
  const backing = browser.createBoundedRegexProvider();
  const requests: browser.RegexWorkerRequest[] = [];
  let created = 0;
  let retired = 0;
  const provider: browser.BoundedRegexProvider = { createWorker(policy) {
    created++;
    const worker = backing.createWorker(policy);
    const postMessage = worker.postMessage.bind(worker);
    const terminate = worker.terminate.bind(worker);
    worker.postMessage = request => { requests.push(request); postMessage(request); };
    worker.terminate = async () => { await terminate(); retired++; };
    return worker;
  } };
  const shell = new browser.Shell({ fs: new browser.MemoryFileSystem() }).use(agentCommands({ regexExecutor: provider }));
  try {
    for (const command of ["grep -E 'a+'", "egrep 'a+'", "fgrep aa", "rg -F aa"]) {
      requests.length = 0;
      const result = await shell.exec(`printf 'aa\\nbb\\n' | ${command}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "aa\n");
      assert.ok(requests.length > 0, command);
      assert.equal(requests[0]!.descriptor.kind, command.startsWith("rg") ? "rg" : "grep");
      assert.equal(created, retired, command);
    }
    requests.length = 0;
    const expression = await shell.exec("expr aa : 'a*'");
    assert.equal(expression.exitCode, 0, expression.stderr);
    assert.equal(expression.stdout, "2\n");
    assert.equal(expression.stderr, "");
    assert.equal(requests[0]!.descriptor.kind, "expr-match");
    const unsupported = await shell.exec("printf 'aa\\n' | rg 'a+'");
    assert.equal(unsupported.exitCode, 2);
    assert.equal(unsupported.stdout, "");
    assert.match(unsupported.stderr, /unsupported/);
    assert.equal(created, retired);
  } finally { await shell.dispose(); }
  assert.equal(created, retired);
});

test("portable compression and archives preserve binary streams", async () => {
  const fs = new browser.MemoryFileSystem();
  const shell = new browser.Shell({ fs }).use(agentCommands({ regexExecutor: browser.createBoundedRegexProvider() }));
  try {
    const binary = await shell.exec("printf '\\000\\377A' | base64 | base64 -d | gzip -c | gunzip -c");
    assert.equal(binary.exitCode, 0, binary.stderr);
    assert.deepEqual(binary.stdoutBytes, Uint8Array.of(0, 255, 65));
    await fs.writeFile("/input", Uint8Array.of(0, 255, 65));
    await fs.mkdir("/output");
    const archive = await shell.exec("tar -cf - /input | tar -xf - -C /output");
    assert.equal(archive.exitCode, 0, archive.stderr);
    assert.deepEqual(await fs.readFile("/output/input"), Uint8Array.of(0, 255, 65));
  } finally { await shell.dispose(); }
});
