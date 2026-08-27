import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandRegistry, FsError, pipeBytes } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { discoveryFixCases, discoveryFixFiles, discoveryFixFileText } from "./invocation-discovery-fixes-cases.js";
import { discoveryProfile } from "../shell-stress/canonical-profile-migration/discovery-profile.js";

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const profile = discoveryProfile("GNU-5.3");
for (const row of profile.observations) test(`${profile.name}/${row.mode}/${row.name}`, async () => {
  assert.equal(row.source, discoveryFixCases.find(fixture => fixture.name === row.name)?.source);
  const fs = new MemoryFileSystem();
  for (const file of discoveryFixFiles) {
    const path = `${row.cwd}/${file}`;
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(path, Buffer.from(discoveryFixFileText), { mode: 0o755 });
  }
  await fs.symlink("closuretool", `${row.cwd}/tools/linktool`);
  const forbidden = new Set(["readFile", "readFileStream", "writeFile", "writeFileStream", "appendFile", "mkdir", "rm", "rmdir", "rename", "copyFile", "symlink", "link", "chmod", "utimes"]);
  const guarded = new Proxy(fs, { get(target, key) {
    if (forbidden.has(String(key))) return () => { assert.fail(`discovery must not perform ${String(key)}`); };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs: guarded, cwd: row.cwd, env: { PATH: "", LC_ALL: "C", LANG: "C", HOME: row.cwd, TZ: "UTC" } });
  const result = await shell.exec(row.mode === "bash" ? row.source : `sh -c ${quote(row.source)} shell`);
  assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), status: result.exitCode }, row.result);
});

test("honest builtin, registry and interpreter labels remain distinct", async () => {
  const commands = new CommandRegistry([{ name: "custom", execute: () => ({ exitCode: 31 }) }]);
  const result = await new Shell({ fs: new MemoryFileSystem(), commands }).exec("PATH=; command -V true custom bash sh; type -t true custom bash sh");
  assert.equal(result.stdout, "true is a shell builtin\ncustom is a registered command\nbash is a virtual shell interpreter\nsh is a virtual shell interpreter\nbuiltin\ncommand\ninterpreter\ninterpreter\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("unsupported command-p never supplies host defaults", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  for (const source of ["command -p true", "command -Vp true", "command -pV true"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported option/u);
  }
  const missing = await shell.exec("PATH=; command -v ls env node");
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "");
});

test("invalid options reject before registry dispatch or input consumption", async () => {
  let pulled = false;
  const commands = new CommandRegistry([{ name: "custom", execute: () => { assert.fail("must not dispatch"); } }]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  const result = await shell.exec("command -z custom", { stdin: { async *[Symbol.asyncIterator]() { pulled = true; yield Buffer.from("input"); } } });
  assert.equal(pulled, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "shell: line 1: command: -z: invalid option\ncommand: usage: command [-pVv] command [arg ...]\n");
});

test("command dispatch still bypasses functions through middleware and origin", async () => {
  const calls: string[] = [];
  const commands = new CommandRegistry([{ name: "custom", async execute(context) {
    assert.equal(context.stdinIsDefault, false);
    assert.deepEqual(context.args, ["", "a b"]);
    await pipeBytes(context.stdin, context.stdout, context.signal);
    return { exitCode: 31 };
  } }]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  shell.use(async (context, next) => { calls.push(context.command); return next(); });
  const result = await shell.exec('custom() { false; }; command custom "" "a b"', { stdin: Uint8Array.from([0, 255, 239, 187, 191]) });
  assert.equal(result.exitCode, 31);
  assert.deepEqual(result.stdoutBytes, Uint8Array.from([0, 255, 239, 187, 191]));
  assert.deepEqual(calls, ["command", "custom"]);
});

test("verbose lookup remains cancellable with typed reason identity", async () => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "cancelled" });
  const fs = new MemoryFileSystem();
  const wrapped = new Proxy(fs, { get(target, key) {
    if (key === "stat") return async () => { controller.abort(reason); throw reason; };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(new Shell({ fs: wrapped }).exec("PATH=tools; command -V closuretool", { signal: controller.signal }), error => error === reason);
});

test("verbose output and invalid diagnostics retain output budget", async () => {
  for (const source of ["command -V true", "command -z true"]) {
    await assert.rejects(new Shell({ fs: new MemoryFileSystem() }).exec(source, { limits: { maxOutputBytes: 5 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  }
});

test("discovery retains command budget through nested command", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  assert.equal((await shell.exec("command command -V true", { limits: { maxCommands: 2 } })).exitCode, 0);
  await assert.rejects(shell.exec("command command -V true", { limits: { maxCommands: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxCommands");
});

test("middleware diagnostic sink retains the command invocation name", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  let text = "";
  shell.use(async (context, next) => {
    if (context.command === "command") Object.defineProperty(context, "stderr", { value: { async write(chunk: Uint8Array) { text += Buffer.from(chunk).toString(); } } });
    return next();
  });
  const result = await shell.exec("bash -c 'command -z true' named");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "");
  assert.equal(text, "named: line 1: command: -z: invalid option\ncommand: usage: command [-pVv] command [arg ...]\n");
});
