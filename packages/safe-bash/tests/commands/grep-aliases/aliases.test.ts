import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, type CommandDefinition, type PluginHost } from "../../../src/contracts/index.js";
import { createGrepAliasCommands, egrepCommand, fgrepCommand, grepAliasCommands } from "../../../src/commands/grep-aliases/index.js";
import { grepCommands } from "../../../src/commands/grep.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { run } from "./helpers.js";

test("standalone plugin pipes both aliases without registered grep", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(grepAliasCommands());
  try {
    const result = await shell.exec("egrep 'cat|dog' | fgrep 'cat'", { stdin: "cat\ndog\nno\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "cat\n");
    assert.equal(result.stderr, "");
    assert.equal(shell.commands.has("grep"), false);
    assert.deepEqual(shell.commands.list().map(command => command.name), ["egrep", "fgrep"]);
  } finally { await shell.dispose(); }
});

test("literal invoke argv, middleware, VFS and parent state survive aliases", async () => {
  const fs = new MemoryFileSystem();
  const pattern = "$(touch /escape); * [x]";
  await fs.writeFile("/a b", Buffer.from(`${pattern}\nno\n`));
  const shell = new Shell({ fs }).use(grepAliasCommands());
  const visits: string[] = [];
  shell.use(async (context, next) => { visits.push(context.command); return next(); });
  shell.register({ name: "literal", async execute(context) {
    assert.ok(context.invoke);
    const args = Object.freeze(["-x", "--", pattern, "a b"]);
    const parentEnv = context.env;
    const before = { cwd: context.cwd, env: { ...context.env }, args: [...context.args] };
    const result = await context.invoke("fgrep", args);
    assert.equal(context.env, parentEnv);
    assert.deepEqual({ cwd: context.cwd, env: { ...context.env }, args: context.args }, before);
    assert.deepEqual(args, ["-x", "--", pattern, "a b"]);
    return result;
  } });
  try {
    const result = await shell.exec("literal");
    assert.equal(result.stdout, `${pattern}\n`);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(visits, ["literal", "fgrep"]);
    await assert.rejects(fs.stat("/escape"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});

for (const name of ["egrep", "fgrep"] as const) {
  const factory = name === "egrep" ? egrepCommand : fgrepCommand;
  const mode = name === "egrep" ? "-E" : "-F";
  const conflict = name === "egrep" ? "-F" : "-E";
  test(`${name} standalone factory never dispatches grep`, async () => {
    const result = await run(factory(), [name === "egrep" ? "cat|dog" : "cat|dog"], "cat\ncat|dog\n", {
      command: "untrusted-display-name", invoke: async () => { throw new Error("must not dispatch"); },
    });
    assert.equal(result.stdout.toString(), name === "egrep" ? "cat\ncat|dog\n" : "cat|dog\n");
    assert.equal(result.code, 0);
  });
  const cases = [
    { args: [conflict, "a"], input: "a\n" },
    { args: [mode, "a"], input: "a\n" },
    { args: ["-EF", "a"], input: "a\n" },
    { args: ["--extended-regexp", "--fixed-strings", "a"], input: "a\n" },
    { args: ["-e", conflict], input: `${conflict}\n` },
    { args: ["--", conflict], input: `${conflict}\n` },
    { args: ["-G", "a"], input: "a\n" },
    { args: ["-P", "a"], input: "a\n" },
    { args: ["-e"], input: "" },
    { args: [], input: "" },
    { args: ["a", "missing"], input: "" },
    { args: ["-s", "a", "missing"], input: "" },
    { args: ["-m0", "a"], input: "a\n" },
    { args: ["-f", "-", "data"], input: "a\n" },
    { args: ["-f", "empty", "data"], input: "" },
    { args: ["-f", "patterns", "-e", "no", "data"], input: "" },
    { args: ["-Hnz", "a"], input: "no\0a\0" },
  ];
  for (const [index, fixture] of cases.entries()) test(`${name} delegates exact grep profile ${index}: ${fixture.args.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/data", Buffer.from("a\nno\n"));
    await fs.writeFile("/empty", new Uint8Array());
    await fs.writeFile("/patterns", Buffer.from("a\n"));
    const expected = await run(grepCommands()[0]!, [mode, ...fixture.args], fixture.input, { fs, command: name });
    const actual = await run(factory(), fixture.args, fixture.input, { fs });
    assert.deepEqual(actual, expected);
  });
  test(`${name} reports matcher conflict with alias diagnostic`, async () => {
    const result = await run(factory(), [conflict, "a"], "a\n");
    assert.equal(result.code, 2);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.toString(), `${name}: conflicting matchers specified\n`);
  });
}

function host(commands: CommandRegistry): PluginHost {
  return { commands, use() { assert.fail("unexpected middleware"); }, registerFileSystem() { assert.fail("unexpected filesystem"); } };
}

test("plugin preflights both collisions without partial registration", async () => {
  for (const name of ["egrep", "fgrep"]) {
    const prior: CommandDefinition = { name, execute: () => ({ exitCode: 42 }) };
    const commands = new CommandRegistry([prior]);
    assert.throws(() => grepAliasCommands().setup(host(commands)), /Command already registered/);
    assert.deepEqual(commands.list().map(command => command.name), [name]);
    assert.equal(commands.get(name)!.execute, prior.execute);
    await grepAliasCommands({ replace: true }).setup(host(commands));
    assert.equal(commands.list().length, 2);
    assert.notEqual(commands.get(name)!.execute, prior.execute);
  }
});

test("regex configuration is validated without registering either alias", () => {
  assert.throws(() => createGrepAliasCommands({ regex: { maxWorkers: 0 } }), /maxWorkers/);
  const commands = new CommandRegistry();
  assert.throws(() => grepAliasCommands({ regex: { maxWorkers: 0 } }).setup(host(commands)), /maxWorkers/);
  assert.equal(commands.list().length, 0);
});
