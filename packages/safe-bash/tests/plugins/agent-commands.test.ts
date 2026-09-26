import assert from "node:assert/strict";
import test from "node:test";
import { createNodeRegexProvider } from "../../src/node.js";
import {
  agentCommands, createAgentCommands, CommandRegistry, createMemoryFileSystem, Shell,
  toByteSource, RegexExecutor,
  type AgentCommandsOptions, type CommandContext, type PluginHost, type ShellCapabilities,
} from "../../src/index.js";

import { exiftoolCommands } from "../../src/commands/exiftool/index.js";
import { wkhtmltopdfCommands, wkhtmltopdfLimits } from "../../src/commands/wkhtmltopdf/index.js";

for (const flags of ['-c', '--characters', '-sc', '--char']) {
  for (const pipe of [false, true]) {
    test(`default fold admits ${flags} through ${pipe ? 'a pipe' : 'a named file'}`, async t => {
      const fs = createMemoryFileSystem();
      const shell = new Shell({ fs }).use(agentCommands());
      t.after(() => shell.dispose());
      const input = new TextEncoder().encode('ChangedAlpha Beta Gamma\r\n');
      await fs.writeFile('/Changed fold.txt', input);
      const result = await shell.exec(pipe
        ? `cat '/Changed fold.txt' | fold ${flags} -w3`
        : `fold ${flags} -w3 '/Changed fold.txt'`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, flags === '-sc'
        ? 'Cha\nnge\ndAl\npha\n \nBet\na \nGam\nma\r\n'
        : 'Cha\nnge\ndAl\npha\n Be\nta \nGam\nma\r\n');
      assert.deepEqual(await fs.readFile('/Changed fold.txt'), input);
    });
  }
}

function host(commands = new CommandRegistry()): PluginHost {
  return { commands, use() { throw new Error("Unexpected middleware installation"); }, registerFileSystem() { throw new Error("Unexpected filesystem installation"); } };
}

const regexConfigurations: AgentCommandsOptions["regex"][] = [undefined, { requestTimeoutMs: 17 }, {
  requestTimeoutMs: 17, startupTimeoutMs: 19, maxWorkers: 1, maxQueuedRequests: 0,
  maxQueuedBytes: 0, idleTimeoutMs: 23, workerOldGenerationMb: 8, workerStackMb: 2,
}];
for (const configured of regexConfigurations) {
  test(`forwarded regex limits can construct an executor: ${JSON.stringify(configured)}`, async t => {
    const rejected = new Error("configured regex provider reached");
    const createWorker = t.mock.fn(() => { throw rejected; });
    const provider = { createWorker };
    const regex = configured && { ...configured };
    const plugin = agentCommands({ regexExecutor: provider, ...(regex === undefined ? {} : { regex }) });
    if (regex) regex.requestTimeoutMs = 99;
    const errors: unknown[] = [];
    const shell = new Shell({ fs: createMemoryFileSystem(), onInternalError: error => { errors.push(error); } }).use(plugin);
    t.after(() => shell.dispose());
    shell.register({ name: "regex-probe", async execute(context) {
      const capability = context.capabilities?.regex as ShellCapabilities["regex"];
      assert.ok(capability);
      assert.equal(capability.executor, provider);
      assert.deepEqual(capability.limits, configured ?? {});
      assert.ok(Object.isFrozen(capability.limits));
      const executor = new RegexExecutor(capability.executor, capability.limits);
      context.registerCleanup?.(() => executor.dispose());
      try {
        await assert.rejects(executor.request({ kind: "grep", patterns: ["x"], fixed: false,
          extended: true, insensitive: false, whole: false, word: false },
        [{ bytes: Uint8Array.of(120), all: true, terminated: true }], context.signal), error => error === rejected);
        return { exitCode: 0 };
      } finally { await executor.dispose(); }
    } });
    shell.register({ name: "nested-regex-probe", execute: context => context.invoke!("regex-probe", []) });
    const result = await shell.exec("nested-regex-probe");
    assert.deepEqual(errors, []);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(createWorker.mock.callCount(), 1);
  });
}

test("agent regex capabilities still reject invalid explicit limits", () => {
  const invalid: NonNullable<AgentCommandsOptions["regex"]>[] = [{ requestTimeoutMs: 0 }, { startupTimeoutMs: 2147483648 },
    { maxWorkers: -1 }, { maxQueuedRequests: -1 }, { maxQueuedBytes: NaN }, { idleTimeoutMs: Infinity }];
  for (const regex of invalid) {
    assert.throws(() => agentCommands({ regex }), RangeError);
  }
});

test("default fold counting flags use the last requested mode in UTF-8", async t => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: 'C.UTF-8' } }).use(agentCommands());
  t.after(() => shell.dispose());
  for (const flags of ['-bc', '-b -c', '--bytes --characters']) {
    const result = await shell.exec(`printf 'ab\\rcd' | fold ${flags} -w2`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'ab\rcd');
    assert.equal(result.stderr, '');
  }
  for (const flags of ['-cb', '-c -b', '--characters --bytes']) {
    const result = await shell.exec(`printf 'ab\\rcd' | fold ${flags} -w2`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'ab\n\rc\nd');
    assert.equal(result.stderr, '');
  }
  const unicode = await shell.exec("printf 'éé' | fold -c -w2");
  assert.equal(unicode.stdout, 'éé');
  assert.equal(unicode.exitCode, 0);
  const invalid = await shell.exec("printf abc | fold --characters=yes");
  assert.equal(invalid.exitCode, 1);
  assert.equal(invalid.stdout, '');
});

async function direct(commands: CommandRegistry, command: string, args: readonly string[], input = "") {
  const chunks: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context: CommandContext = {
    command, args, stdin: toByteSource(input), stdinIsDefault: false,
    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
    stderr: { async write(chunk) { errors.push(chunk.slice()); } },
    fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
  };
  const result = await commands.get(command)!.execute(context);
  return { ...result, stdout: Buffer.concat(chunks).toString(), stderr: Buffer.concat(errors).toString() };
}

test("aggregate definitions are exactly the delivered families, each registered once", async () => {
  const expected = [
    "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
    "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
    "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find", "cmp", "fmt", "shuf", "numfmt",
    "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha512sum", "sha384sum", "sha256sum", "sha224sum", "sha1sum",
    "md5sum", "cksum", "gzip", "gunzip", "zcat", "bzip2", "bunzip2", "bzcat", "xz", "unxz", "xzcat", "zstd", "unzstd", "zstdcat", "diff", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "zip", "unzip",
    "paste", "comm", "join", "tac", "expand", "fold", "strings",
    "seq", "nl", "rev", "unexpand", "split",
    "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "xq", "xmllint", "csplit", "pr", "tsort", "factor", "getopt", "hexdump", "hd", "iconv", "dos2unix", "unix2dos",
  ].sort();
  assert.equal(expected.length, 110);
  assert.equal(new Set(expected).size, 110);
  assert.deepEqual(createAgentCommands().map(command => command.name).sort(), expected);
  const target = host();
  await agentCommands().setup(target);
  assert.deepEqual(target.commands.list().map(command => command.name).sort(), expected);
});

for (const conflict of ["printf", "sed", "jq", "rg", "gzip", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "paste", "comm", "join", "date", "sleep", "printenv", "tree", "file"]) {
  test(`collision with ${conflict} leaves the entire host registry untouched`, () => {
    const commands = new CommandRegistry([{ name: conflict, execute: () => ({ exitCode: 23 }) }]);
    const before = commands.list();
    assert.throws(() => agentCommands().setup(host(commands)), /already registered/u);
    assert.deepEqual(commands.list(), before);
  });
}

test("explicit replacement affects all families once and preserves unrelated commands", async () => {
  const target = host(new CommandRegistry([{ name: "custom", execute: () => ({ exitCode: 23 }) }]));
  await agentCommands().setup(target);
  const original = target.commands.list();
  assert.throws(() => agentCommands().setup(target), /already registered/u);
  assert.deepEqual(target.commands.list(), original);
  await agentCommands({ replace: true }).setup(target);
  assert.equal(target.commands.list().length, 111);
  assert.equal(target.commands.get("custom"), original[0]);
  for (const name of ["printf", "sed", "jq", "rg", "gzip", "patch", "chmod", "stat", "mktemp", "truncate", "tar", "paste", "comm", "join"]) {
    assert.notEqual(target.commands.get(name), original.find(command => command.name === name));
  }
});

test("invalid eager family limits install no commands", () => {
  const target = host();
  assert.throws(() => agentCommands({ structured: { limits: { maxSteps: 0 } } }).setup(target), /positive/u);
  assert.equal(target.commands.list().length, 0);
});

for (const kind of ["definitions", "plugin"] as const) {
  test(`${kind} fallback resolves nested argv across families without a shell`, async () => {
    const options = { regexExecutor: createNodeRegexProvider() };
    const commands = kind === "definitions" ? new CommandRegistry(createAgentCommands(options)) : new CommandRegistry();
    if (kind === "plugin") await agentCommands(options).setup(host(commands));
    assert.deepEqual(await direct(commands, "env", ["sed", "s/a/A/"], "a\n"), { exitCode: 0, stdout: "A\n", stderr: "" });
    assert.deepEqual(await direct(commands, "xargs", ["jq", "-nc"], "'1+1'"), { exitCode: 0, stdout: "2\n", stderr: "" });
    assert.deepEqual(await direct(commands, "env", ["env", "rg", "a", "-"], "a\n"), { exitCode: 0, stdout: "a\n", stderr: "" });
    const missing = await direct(commands, "env", ["not-a-command"]);
    assert.equal(missing.exitCode, 127);
    assert.match(missing.stderr, /command not found/u);
  });
}

test("plugin fallback can resolve host commands outside the aggregate", async () => {
  const target = host(new CommandRegistry([{ name: "custom", execute: () => ({ exitCode: 23 }) }]));
  await agentCommands().setup(target);
  assert.equal((await direct(target.commands, "env", ["custom"])).exitCode, 23);
});

test("custom fallback applies only without the shell invocation hook", async () => {
  let calls = 0;
  const options = { execute: () => { calls++; return { exitCode: 17 }; } };
  const commands = new CommandRegistry(createAgentCommands(options));
  assert.equal((await direct(commands, "env", ["sed", "s/a/A/"], "a")).exitCode, 17);
  assert.equal(calls, 1);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands(options));
  const invoked: string[] = [];
  shell.use(async (context, next) => { invoked.push(context.command); return next(); });
  try {
    assert.equal((await shell.exec("env sed 's/a/A/'", { stdin: "a\n" })).stdout, "A\n");
    assert.deepEqual(invoked, ["env", "sed"]);
    assert.equal(calls, 1);
  } finally { await shell.dispose(); }
});

const limited: readonly [AgentCommandsOptions, string, string, RegExp][] = [
  [{ text: { maxBufferBytes: 1 } }, "sed p", "long\n", /buffer limit/u],
  [{ structured: { limits: { maxInputBytes: 1 } } }, "jq .", "[1]", /maxInputBytes/u],
  [{ search: { maxLineBytes: 1 } }, "rg x -", "xxxx\n", /limit/u],
  [{ diffPatch: { maxInputBytes: 1 } }, "printf 'ab\\n' > first; printf 'cd\\n' > second; diff first second", "", /limit|maxBytes/u],
  [{ metadata: { limits: { maxOutputBytes: 1 } } }, "mkdir /tmp; mktemp", "", /limit/u],
  [{ archive: { limits: { maxArchiveBytes: 1 } } }, "printf content > input; tar -cf - input", "", /limit/u],
  [{ tableText: { limits: { maxRecordBytes: 1 } } }, "paste -", "ab\n", /record limit/u],
];
for (const [options, source, stdin, diagnostic] of limited) {
  test(`aggregate forwards ${Object.keys(options)[0]} limits without rewriting them`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createNodeRegexProvider(), ...options }));
    try {
      const result = await shell.exec(source, { stdin });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, diagnostic);
    } finally { await shell.dispose(); }
  });
}

test("search defaultInput remains an explicit family override", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Buffer.from("match\n"));
  const shell = new Shell({ fs }).use(agentCommands({ regexExecutor: createNodeRegexProvider(), search: { defaultInput: "stdin" } }));
  try {
    const result = await shell.exec("rg match");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("README aggregate example and binary pipelines use the actual shell", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("printf 'hello\\n' | sed 's/hello/world/' | awk '{print $1}'");
    assert.equal(result.stdout, "world\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const bytes = await shell.exec("printf '\\000\\377A' | base64 | base64 -d | gzip -c | gunzip -c");
    assert.equal(bytes.exitCode, 0, bytes.stderr);
    assert.deepEqual(bytes.stdoutBytes, Uint8Array.of(0, 255, 65));
  } finally { await shell.dispose(); }
});

test("aggregate tar streams binary archives through the actual VFS pipeline", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/input"); await fs.mkdir("/output");
  await fs.writeFile("/input/bytes", Uint8Array.of(0, 255, 65, 10));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("tar -cf - -C /input bytes | tar -xf - -C /output");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/output/bytes"), Uint8Array.of(0, 255, 65, 10));
    assert.deepEqual(await fs.readFile("/input/bytes"), Uint8Array.of(0, 255, 65, 10));
    assert.equal(createAgentCommands().some(command => command.name === "curl" || command.name === "safejs"), false);
  } finally { await shell.dispose(); }
});

test("aggregate table-text composes with existing cut and virtual files", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec("printf '1 alice\n2 bob\n' > names; printf '1 red\n2 blue\n' > colors; join names colors | cut -d ' ' -f2,3 | paste -sd, -");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "alice red,bob blue\n");
    assert.equal(result.stderr, "");
    const common = await shell.exec("printf 'a\nb\n' > first; printf 'b\nc\n' > second; comm -12 first second");
    assert.equal(common.exitCode, 0, common.stderr);
    assert.equal(common.stdout, "b\n");
    assert.equal(createAgentCommands().filter(command => command.name === "cut").length, 1);
  } finally { await shell.dispose(); }
});

for (const [name, plugin, source, expected] of [
  ["exiftool", exiftoolCommands({ replace: true }), "exiftool -s3 -Title /image.png", "packed\n"],
  ["wkhtmltopdf", wkhtmltopdfCommands({ limits: wkhtmltopdfLimits, replace: true }), "wkhtmltopdf --help", "Usage: wkhtmltopdf [options] [page|cover input|toc]... output\nBuilt-in PDF AST static renderer; trusted overrides are optional. Input/output '-' use stdin/stdout.\n"],
] as const) {
  test(`${name} opt-in dispatch preserves middleware through pipes and VFS scripts`, async () => {
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs }).use(agentCommands());
    await fs.writeFile("/image.png", Uint8Array.of(137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,4,0,0,0,181,28,12,2,0,0,0,12,116,69,88,116,84,105,116,108,101,0,112,97,99,107,101,100,41,161,151,116,0,0,0,11,73,68,65,84,120,218,99,252,255,31,0,3,3,2,0,239,162,167,91,0,0,0,0,73,69,78,68,174,66,96,130));
    const seen: string[] = [];
    shell.use(async (context, next) => { seen.push(context.command); return next(); });
    try {
      assert.equal(shell.commands.has(name), false);
      assert.equal((await shell.exec(source)).exitCode, 127);
      shell.register({ name, execute: () => ({ exitCode: 23 }) });
      assert.throws(() => (name === "exiftool" ? exiftoolCommands() : wkhtmltopdfCommands()).setup(host(shell.commands)), /already registered/u);
      assert.equal((await shell.exec(source)).exitCode, 23);
      shell.use(plugin);
      const direct = await shell.exec(source);
      assert.equal(direct.exitCode, 0);
      assert.equal(direct.stdout, expected);
      assert.equal(direct.stderr, "");
      const installed = shell.commands.get(name);
      await fs.writeFile("/command.sh", new TextEncoder().encode(source + " | cat\n"));
      seen.length = 0;
      const result = await shell.exec("sh /command.sh");
      assert.deepEqual(result, { exitCode: 0, stdout: expected, stderr: "", stdoutBytes: new TextEncoder().encode(expected), stderrBytes: new Uint8Array() });
      assert.ok(seen.includes("sh"));
      assert.ok(seen.includes(name));
      assert.ok(seen.includes("cat"));
      assert.equal(shell.commands.get(name), installed);
    } finally { await shell.dispose(); }
  });
}
