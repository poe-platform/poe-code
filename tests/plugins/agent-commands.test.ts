import assert from "node:assert/strict";
import test from "node:test";
import {
  agentCommands, createAgentCommands, CommandRegistry, createMemoryFileSystem, Shell,
  toByteSource,
  type AgentCommandsOptions, type CommandContext, type PluginHost,
} from "../../src/index.js";

function host(commands = new CommandRegistry()): PluginHost {
  return { commands, use() { throw new Error("Unexpected middleware installation"); }, registerFileSystem() { throw new Error("Unexpected filesystem installation"); } };
}

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
    "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
    "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha256sum", "sha1sum",
    "md5sum", "cksum", "gzip", "gunzip", "zcat", "diff", "patch", "chmod", "stat", "mktemp", "tar",
    "paste", "comm", "join", "tac", "expand", "fold", "strings",
    "seq", "nl", "rev", "unexpand", "split",
    "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "git",
  ].sort();
  assert.equal(expected.length, 80);
  assert.equal(new Set(expected).size, 80);
  assert.deepEqual(createAgentCommands().map(command => command.name).sort(), expected);
  const target = host();
  await agentCommands().setup(target);
  assert.deepEqual(target.commands.list().map(command => command.name).sort(), expected);
});

for (const conflict of ["printf", "sed", "jq", "rg", "gzip", "patch", "chmod", "stat", "mktemp", "tar", "paste", "comm", "join", "date", "sleep", "printenv", "tree", "file"]) {
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
  assert.equal(target.commands.list().length, 81);
  assert.equal(target.commands.get("custom"), original[0]);
  for (const name of ["printf", "sed", "jq", "rg", "gzip", "patch", "chmod", "stat", "mktemp", "tar", "paste", "comm", "join"]) {
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
    const commands = kind === "definitions" ? new CommandRegistry(createAgentCommands()) : new CommandRegistry();
    if (kind === "plugin") await agentCommands().setup(host(commands));
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
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands(options));
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
  const shell = new Shell({ fs }).use(agentCommands({ search: { defaultInput: "stdin" } }));
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
