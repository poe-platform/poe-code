import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  agentCommands, CommandRegistry, createAgentCommands, createMemoryFileSystem,
  createRealFileSystem, createStreamInspectionCommands, Shell, ShellLimitError,
  streamInspectionCommands, toByteSource,
  type AgentCommandsOptions, type CommandContext, type PluginHost,
  type StreamInspectionCommandsOptions, type StreamInspectionLimits,
} from "../../../src/index.js";

const names = ["tac", "expand", "fold", "strings"];
const cases = [
  { name: "tac", args: [], input: "old\nnew\n", output: "new\nold\n" },
  { name: "expand", args: ["-4"], input: "a\tb\n", output: "a   b\n" },
  { name: "fold", args: ["-3"], input: "abcdefg", output: "abc\ndef\ng" },
  { name: "strings", args: ["-5"], input: "four\0fives\0ending", output: "fives\nending\n" },
];

function host(commands = new CommandRegistry()): PluginHost {
  return { commands, use() { throw new Error("Unexpected middleware"); }, registerFileSystem() { throw new Error("Unexpected filesystem"); } };
}

test("root family exports preserve four inspection definitions in the 80-command aggregate", async () => {
  const limits: Partial<StreamInspectionLimits> = { maxInputBytes: 1024 };
  const options: StreamInspectionCommandsOptions = { limits };
  const aggregate: AgentCommandsOptions = { streamInspection: options };
  assert.deepEqual(createStreamInspectionCommands(options).map(command => command.name), names);
  const definitions = createAgentCommands(aggregate).map(command => command.name);
  assert.equal(definitions.length, 80);
  assert.equal(new Set(definitions).size, 80);
  assert.deepEqual(definitions.slice(56, 60), names);
  assert.deepEqual(definitions.slice(60), ["seq", "nl", "rev", "unexpand", "split", "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "git"]);
  const target = host();
  await agentCommands(aggregate).setup(target);
  assert.deepEqual(target.commands.list().map(command => command.name), definitions);
  for (const name of ["curl", "safejs"]) assert.equal(target.commands.has(name), false);
});

for (const mode of ["factory", "plugin"] as const) {
  for (const fixture of cases) {
    test(`${mode} actual Shell dispatch: ${fixture.name}`, async () => {
      const fs = createMemoryFileSystem();
      const shell = mode === "factory"
        ? new Shell({ fs, commands: new CommandRegistry(createAgentCommands()) })
        : new Shell({ fs }).use(agentCommands());
      const seen: string[] = [];
      shell.use(async (context, next) => { seen.push(context.command); return next(); });
      try {
        const result = await shell.exec([fixture.name, ...fixture.args].join(" "), { stdin: fixture.input });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, fixture.output);
        assert.equal(result.stderr, "");
        assert.deepEqual(seen, [fixture.name]);
        assert.ok(shell.commands.has(fixture.name));
      } finally { await shell.dispose(); }
    });
  }
}

for (const name of names) {
  test(`aggregate preflights ${name} before installing any family`, () => {
    const original = { name, execute: () => ({ exitCode: 23 }) };
    const target = host(new CommandRegistry([original]));
    assert.throws(() => agentCommands().setup(target), new RegExp(`already registered: ${name}`, "u"));
    assert.deepEqual(target.commands.list(), [original]);
  });
}

test("standalone and aggregate share one explicit replacement boundary", async () => {
  const custom = { name: "custom", execute: () => ({ exitCode: 23 }) };
  const target = host(new CommandRegistry([custom]));
  await streamInspectionCommands().setup(target);
  const original = target.commands.list();
  assert.throws(() => agentCommands().setup(target), /already registered: tac/u);
  assert.deepEqual(target.commands.list(), original);
  await agentCommands({ replace: true }).setup(target);
  assert.equal(target.commands.list().length, 81);
  assert.equal(target.commands.get("custom"), original.find(command => command.name === "custom"));
  for (const name of names) assert.notEqual(target.commands.get(name), original.find(command => command.name === name));
  const aggregate = target.commands.list();
  assert.throws(() => streamInspectionCommands().setup(target), /already registered: tac/u);
  assert.deepEqual(target.commands.list(), aggregate);
  await streamInspectionCommands({ replace: true }).setup(target);
  assert.equal(target.commands.list().length, 81);
  assert.equal(target.commands.get("printf"), aggregate.find(command => command.name === "printf"));
});

test("aggregate validates stream limits before registration", () => {
  const target = host();
  assert.throws(() => agentCommands({ streamInspection: { limits: { maxInputBytes: 0 } } }).setup(target), /Invalid stream-inspection limit: maxInputBytes/u);
  assert.deepEqual(target.commands.list(), []);
});

test("stream family limits reach all four defaults without restricting other families", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ streamInspection: { limits: { maxInputBytes: 3 } } }));
  try {
    for (const name of names) {
      const result = await shell.exec(name, { stdin: "abcd" });
      assert.equal(result.exitCode, 1, name);
      assert.match(result.stderr, /stream-inspection input limit exceeded/u);
    }
    const result = await shell.exec("cat", { stdin: "abcd" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "abcd");
  } finally { await shell.dispose(); }
});

for (const backend of ["memory", "real"] as const) {
  test(`${backend} defaults preserve byte pipes and VFS publication`, async () => {
    const directory = backend === "real" ? await mkdtemp(fileURLToPath(new URL("./author-real-", import.meta.url))) : undefined;
    const fs = directory ? await createRealFileSystem({ root: directory }) : createMemoryFileSystem();
    const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
    try {
      const report = await shell.exec("printf 'old\\tline\\nnew\\tline\\n' > log; tac log | expand -4 | fold -bw8 > report; cat report");
      assert.equal(report.exitCode, 0, report.stderr);
      assert.equal(report.stderr, "");
      assert.equal(report.stdout, "new line\nold line\n");
      assert.deepEqual(Buffer.from(await fs.readFile("/report")), Buffer.from(report.stdout));
      await fs.writeFile("/artifact", Uint8Array.of(0, 77, 65, 71, 73, 67, 0, 112, 97, 121, 108, 111, 97, 100, 255));
      const markers = await shell.exec("strings -5 artifact | tac | head -n1");
      assert.equal(markers.exitCode, 0, markers.stderr);
      assert.equal(markers.stdout, "payload\n");
      const input = Uint8Array.of(255, 0, 120, 10, 89, 10);
      const expected = Uint8Array.of(89, 10, 255, 0, 120, 10);
      const bytes = await shell.exec("tac | expand | fold -b -w80 | tee binary | cat", { stdin: input });
      assert.equal(bytes.exitCode, 0, bytes.stderr);
      assert.equal(bytes.stderr, "");
      assert.deepEqual(bytes.stdoutBytes, expected);
      assert.deepEqual(new Uint8Array(await fs.readFile("/binary")), expected);
    } finally {
      await shell.dispose();
      if (directory) await rm(directory, { recursive: true });
    }
  });
}

test("registry-only fallback dispatches all four without an invocation stub", async () => {
  const commands = new CommandRegistry(createAgentCommands());
  for (const fixture of cases) {
    const output: Uint8Array[] = [], errors: Uint8Array[] = [];
    const context: CommandContext = {
      command: "env", args: [fixture.name, ...fixture.args], stdin: toByteSource(fixture.input), stdinIsDefault: false,
      stdout: { async write(chunk) { output.push(chunk.slice()); } },
      stderr: { async write(chunk) { errors.push(chunk.slice()); } },
      fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
    };
    assert.equal((await commands.get("env")!.execute(context)).exitCode, 0);
    assert.equal(Buffer.concat(output).toString(), fixture.output);
    assert.equal(Buffer.concat(errors).toString(), "");
  }
});

test("actual invoke retains literal argv, middleware, VFS and shared output budget", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/literal; echo BAD", Buffer.from("first\nsecond\n"));
  const commands = new CommandRegistry(createAgentCommands());
  commands.register({ name: "forward", execute(context) {
    assert.ok(context.invoke);
    return context.invoke("tac", ["/literal; echo BAD"]);
  } });
  const shell = new Shell({ fs, commands });
  const seen: string[] = [];
  shell.use(async (context, next) => { seen.push(context.command); return next(); });
  try {
    const result = await shell.exec("forward");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "second\nfirst\n");
    assert.deepEqual(seen, ["forward", "tac"]);
    await assert.rejects(shell.exec("forward", { limits: { maxOutputBytes: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});

test("default bundle leaves optional curl and SafeJS unavailable", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    for (const name of ["curl", "safejs"]) {
      const result = await shell.exec(name);
      assert.equal(result.exitCode, 127);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /command not found/u);
      assert.equal(shell.commands.has(name), false);
    }
  } finally { await shell.dispose(); }
});
