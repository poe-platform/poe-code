import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentCommands, CommandRegistry, createAgentCommands, createExprCommand, createExprCommands, createMemoryFileSystem, exprCommands, FsError, Shell, type AgentCommandsOptions, type CommandContext, type CommandDefinition, type InvocationCleanup, type PluginHost } from "../../../src/index.js";

const expected = JSON.parse(readFileSync(new URL("./PRE-WIRING.json", import.meta.url), "utf8")) as { names76: string[] };
function host(commands = new CommandRegistry()): PluginHost {
  return { commands, use() { throw new Error("unexpected middleware"); }, registerFileSystem() { throw new Error("unexpected filesystem"); } };
}
async function direct(definition: CommandDefinition, args: string[], overrides: Partial<CommandContext> = {}) {
  const output: Uint8Array[] = [], errors: Uint8Array[] = [], cleanups: InvocationCleanup[] = [];
  const context: CommandContext = { command: "expr", args, cwd: "/", env: { LC_ALL: "C" }, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error("argv-only expr must not acquire stdin"); } },
    stdout: { async write(bytes) { output.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } },
    registerCleanup(cleanup) { cleanups.push(cleanup); }, ...overrides };
  try { return { ...await definition.execute(context), stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() }; }
  finally { await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()])); }
}

test("public80 inventory retains frozen expr76 plus which, timeout, apply_patch and git", async () => {
  assert.equal(expected.names76.length, 76); assert.equal(new Set(expected.names76).size, 76);
  const names80 = [...expected.names76, "which", "timeout", "apply_patch", "git"].sort();
  assert.equal(names80.length, 80); assert.equal(new Set(names80).size, 80);
  assert.deepEqual(createAgentCommands().map(command => command.name).sort(), names80);
  const target = host(); await agentCommands().setup(target);
  assert.deepEqual(target.commands.list().map(command => command.name).sort(), names80);
  for (const name of ["getopts", "curl", "safejs", "node", "npm", "npx"]) assert.equal(target.commands.has(name), false);
});

test("expr aggregate collision preflight and top-level replacement preserve custom commands", async () => {
  const original = { name: "expr", execute: () => ({ exitCode: 23 }) }, custom = { name: "custom", execute: () => ({ exitCode: 24 }) };
  const target = host(new CommandRegistry([original, custom]));
  const registeredCustom = target.commands.get("custom"), registeredExpr = target.commands.get("expr");
  const nested = { expr: { replace: true } } as unknown as AgentCommandsOptions;
  assert.throws(() => agentCommands(nested).setup(target), /already registered: expr/u);
  assert.deepEqual(target.commands.list(), [original, custom]);
  await agentCommands({ ...nested, replace: true }).setup(target);
  assert.equal(target.commands.list().length, 81); assert.equal(target.commands.get("custom"), registeredCustom); assert.notEqual(target.commands.get("expr"), registeredExpr);
});

test("unknown nested expr regex is ignored with and without global regex", () => {
  const nested = { limits: { maxNumericDigits: 1 } };
  Object.defineProperty(nested, "regex", { enumerable: true, get() { throw new Error("nested regex must not be read"); } });
  for (const options of [{ expr: nested }, { expr: nested, regex: { workerOldGenerationMb: 48, workerStackMb: 3 } }]) assert.ok(createAgentCommands(options).some(command => command.name === "expr"));
  assert.throws(() => createAgentCommands({ expr: nested, regex: { maxWorkers: 0 } }), /regex maxWorkers/u);
});

test("standalone factories retain their direct regex validation and replacement", async () => {
  assert.throws(() => createExprCommand({ regex: { maxWorkers: 0 } }), /regex maxWorkers/u);
  assert.deepEqual(createExprCommands().map(command => command.name), ["expr"]);
  const target = host(new CommandRegistry([{ name: "expr", execute: () => ({ exitCode: 23 }) }]));
  assert.throws(() => exprCommands().setup(target), /already registered/u);
  await exprCommands({ replace: true }).setup(target); assert.equal(target.commands.list().length, 1);
  assert.deepEqual(await direct(target.commands.get("expr")!, ["20", "+", "22"]), { exitCode: 0, stdout: "42\n", stderr: "" });
});

test("aggregate expr family limits reach argv-only execution", async () => {
  const definition = createAgentCommands({ expr: { limits: { maxNumericDigits: 1 } } }).find(command => command.name === "expr")!;
  const result = await direct(definition, ["22", "+", "1"]);
  assert.equal(result.exitCode, 3); assert.equal(result.stdout, ""); assert.match(result.stderr, /^expr: .*limit exceeded\n$/u);
});

test("expr actual VFS pipeline has no stdin requirement and preserves empty/zero statuses", async () => {
  const fs = createMemoryFileSystem(), shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("expr 20 + 22 > /answer; cat /answer");
    assert.equal(result.exitCode, 0); assert.equal(result.stdout, "42\n"); assert.equal(result.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/answer")).toString(), "42\n");
    assert.deepEqual(await direct(createExprCommand(), ["0"]), { exitCode: 1, stdout: "0\n", stderr: "" });
    assert.deepEqual(await direct(createExprCommand(), ["+", ""]), { exitCode: 1, stdout: "\n", stderr: "" });
  } finally { await shell.dispose(); }
});

test("expr caller abort preserves identity before admission", async () => {
  const caller = new AbortController(), reason = new FsError("EACCES"); caller.abort(reason);
  await assert.rejects(direct(createExprCommand(), ["7"], { signal: caller.signal }), error => error === reason);
});

test("expr output rejection is not converted to a status or duplicate diagnostic", async () => {
  const reason = new Error("author sink failure"); let writes = 0;
  await assert.rejects(direct(createExprCommand(), ["7"], { stdout: { async write() { writes++; throw reason; } }, stderr: { async write() { assert.fail("unexpected diagnostic"); } } }), error => error === reason);
  assert.equal(writes, 1);
});

test("expr rejected cleanup registration prevents output and worker admission", async () => {
  const reason = new Error("registration closed");
  await assert.rejects(direct(createExprCommand(), ["abc", ":", "a"], { registerCleanup() { throw reason; }, stdout: { async write() { assert.fail("unexpected output"); } }, stderr: { async write() { assert.fail("unexpected diagnostic"); } } }), error => error === reason);
});

test("expr preserves its separately bounded emergency diagnostic and inactive regex branch", async () => {
  assert.deepEqual(await direct(createExprCommand({ limits: { maxOutputBytes: 1 } }), ["7"]), { exitCode: 3, stdout: "", stderr: "expr: output bytes limit exceeded\n" });
  assert.deepEqual(await direct(createExprCommand(), ["yes", "|", "match", "a", "["]), { exitCode: 0, stdout: "yes\n", stderr: "" });
});
