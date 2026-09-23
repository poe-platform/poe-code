import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry, FsError, pipeBytes } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("type -t reports Bash command kinds without exposing dispatch kinds", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("type -t cat printf echo bash sh command test '['");
  assert.equal(result.stdout, "file\nbuiltin\nbuiltin\nfile\nfile\nbuiltin\nbuiltin\nbuiltin\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  const shadowed = await shell.exec("cat() { true; }; type -t cat; type -ft cat; type -at cat");
  assert.equal(shadowed.stdout, "function\nfile\nfunction\nfile\n");
  assert.equal(shadowed.stderr, "");
  assert.equal(shadowed.exitCode, 0);
  const missing = await shell.exec("type -t missing_command");
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "");
  assert.equal(missing.exitCode, 1);
});

test("type -t classifies custom registry commands as files and respects absent commands", async context => {
  const commands = new CommandRegistry([{ name: "custom", execute: () => ({ exitCode: 0 }) }]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands });
  context.after(() => shell.dispose());
  const result = await shell.exec("type -t custom bash command printf echo");
  assert.equal(result.stdout, "file\nfile\nbuiltin\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 1);
});

const cases = [
  { source: "command -p printf hello", stdout: "hello" },
  { source: "command -pV true", stdout: "true is a shell builtin\n" },
  { source: "command -Vp true", stdout: "true is a shell builtin\n" },
  { source: "command -pvVv true", stdout: "true\n" },
  { source: "command -pv -V true", stdout: "true is a shell builtin\n" },
  { source: "command -p; command -pv; command -p --", stdout: "" },
  { source: "printf() { false; }; command -p -- printf hello", stdout: "hello" },
  { source: "command -pV printf", stdout: "printf is a registered command\n" },
  { source: "command -pV bash", stdout: "bash is a virtual shell interpreter\n" },
  { source: "true() { false; }; command -pv true", stdout: "true\n" },
];

for (const { source, stdout } of cases) test(`portable command options: ${source}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(basicCommands()) });
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, stdout);
  assert.equal(result.stderr, "");
});

test("portable lookup searches virtual /bin then /usr/bin without changing PATH bindings", async context => {
  const fs = new MemoryFileSystem();
  for (const directory of ["/bin", "/usr/bin", "/custom"]) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(`${directory}/tool`, Buffer.from(`#!/bin/sh\nprintf '${directory}:<%s>\\n' "$PATH"\n`), { mode: 0o755 });
  }
  const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()), env: { PATH: "/custom" } });
  context.after(() => shell.dispose());
  const result = await shell.exec(`readonly PATH; command -pv tool; command -pV tool; command -p tool; command tool; printf '<%s>\\n' "$PATH"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "/bin/tool\ntool is /bin/tool\n/bin:</custom>\n/custom:</custom>\n</custom>\n");
  assert.equal(result.stderr, "");
  await fs.rm("/bin/tool");
  const fallback = await shell.exec("unset PATH; command -pv tool; command -p tool");
  assert.equal(fallback.exitCode, 0);
  assert.equal(fallback.stdout, "/usr/bin/tool\n/usr/bin:<>\n");
  assert.equal(fallback.stderr, "");
});

test("portable lookup stays scoped to command forwarding", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", Buffer.from("#!/bin/sh\nprintf 'tool\\n'\n"), { mode: 0o755 });
  const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()), env: { PATH: "/custom" } });
  context.after(() => shell.dispose());
  for (const source of ["command -p command tool", "command command -p tool", "command -p command -pv tool"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, source);
    assert.equal(result.stdout, source.endsWith("-pv tool") ? "/bin/tool\n" : "tool\n");
    assert.equal(result.stderr, "");
  }
  for (const source of ["command -p command -v tool", "command -p builtin command -v tool", "command -p eval 'command -v tool'", "command -p sh -c 'command -v tool'"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 1, source);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
  const local = await shell.exec(`probe() { local PATH=/local; command -p tool; printf '<%s>\\n' "$PATH"; }; probe; printf '<%s>\\n' "$PATH"`);
  assert.equal(local.stdout, "tool\n</local>\n</custom>\n");
  assert.equal(local.stderr, "");
  assert.equal(local.exitCode, 0);
});

test("portable command preserves registry middleware, literal arguments, input bytes and environment", async context => {
  const seen: string[] = [];
  const commands = new CommandRegistry([{ name: "custom", async execute(command) {
    assert.deepEqual(command.args, ["", "a b"]);
    assert.equal(command.env.PATH, "/temporary");
    assert.equal(command.stdinIsDefault, false);
    await pipeBytes(command.stdin, command.stdout, command.signal);
    return { exitCode: 31 };
  } }]);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands, env: { PATH: "/original" } });
  context.after(() => shell.dispose());
  shell.use(async (command, next) => { seen.push(command.command); return next(); });
  const result = await shell.exec('custom() { false; }; PATH=/temporary command -p custom "" "a b"', { stdin: Uint8Array.from([0, 255, 128]) });
  assert.equal(result.exitCode, 31);
  assert.deepEqual(result.stdoutBytes, Uint8Array.from([0, 255, 128]));
  assert.equal(result.stderr, "");
  assert.deepEqual(seen, ["command", "custom"]);
});

test("portable lookup never discovers host tools or user PATH-only scripts", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/custom");
  await fs.writeFile("/custom/tool", Buffer.from("true\n"), { mode: 0o755 });
  const shell = new Shell({ fs, env: { PATH: "/custom" } });
  context.after(() => shell.dispose());
  const missing = await shell.exec("command -pv tool ls env node");
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "");
  assert.equal((await shell.exec("command -p tool")).exitCode, 127);
  assert.equal((await shell.exec("command -p /custom/tool")).exitCode, 0);
});

test("portable lookup enforces permissions, path and command budgets", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", Buffer.from("true\n"), { mode: 0o644 });
  const shell = new Shell({ fs });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("command -pv tool")).exitCode, 1);
  assert.equal((await shell.exec("command -p tool")).exitCode, 126);
  for (const [source, limits, limit] of [
    ["command -pv missing", { maxPathComponents: 1 }, "maxPathComponents"],
    ["command -pv missing", { maxFileSystemOperations: 0 }, "maxFileSystemOperations"],
    ["command -p true", { maxCommands: 1 }, "maxCommands"],
    ["command -pV true", { maxOutputBytes: 5 }, "maxOutputBytes"],
  ] as const) {
    await assert.rejects(shell.exec(source, { limits }), error => error instanceof ShellLimitError && error.limit === limit);
  }
});

test("portable lookup preserves cancellation reason identity", async context => {
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "cancelled" });
  const fs = new Proxy(new MemoryFileSystem(), { get(target, key) {
    if (key === "stat") return async () => { controller.abort(reason); throw reason; };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const shell = new Shell({ fs });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("command -pv missing", { signal: controller.signal }), error => error === reason);
});
