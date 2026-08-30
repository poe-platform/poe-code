import assert from "node:assert/strict";
import { CommandRegistry, FsError, pipeBytes } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

const mode = process.argv[2];
assert.ok(mode === "source" || mode === "eval");
const fs = new MemoryFileSystem();
const commands = new CommandRegistry();
const shell = new Shell({ fs, commands });
const execute = (text: string): string => mode === "source" ? ". /lib" : `eval '${text.replaceAll("'", "'\\''")}'`;
async function prepare(text: string) { await fs.writeFile("/lib", Buffer.from(text), { mode: 0o644 }); return execute(text); }
async function limit(source: string, limits: Parameters<Shell["exec"]>[1], name: string) {
  await assert.rejects(shell.exec(source, limits), error => error instanceof ShellLimitError && error.limit === name);
}
await limit(await prepare(mode === "source" ? ". /lib" : 'eval "$CODE"'), { env: { CODE: 'eval "$CODE"' }, limits: { maxSubstitutionDepth: 6 } }, "maxSubstitutionDepth");
await limit(await prepare("while true; do :; done"), { limits: { maxLoopIterations: 3 } }, "maxLoopIterations");
await limit(await prepare(":; :; :; :"), { limits: { maxCommands: 3 } }, "maxCommands");
const unicode = await prepare('VALUE="é"');
const sourceBytes = Buffer.byteLength(unicode) + Buffer.byteLength('VALUE="é"');
await shell.exec(unicode, { limits: { maxSourceBytes: sourceBytes } });
await limit(unicode, { limits: { maxSourceBytes: sourceBytes - 1 } }, "maxSourceBytes");
await limit(await prepare("pwd; pwd"), { limits: { maxOutputBytes: 1 } }, "maxOutputBytes");
let origin: boolean | undefined;
commands.register({ name: "stream", async execute(context) { origin = context.stdinIsDefault; await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 }; } });
const bytes = Uint8Array.from([0, 255, 239, 187, 191, 10]);
const streamed = await shell.exec(await prepare("stream"), { stdin: bytes });
assert.deepEqual(streamed.stdoutBytes, bytes);
assert.equal(origin, false);
let exported: string | undefined;
commands.register({ name: "observe", execute(context) { exported = context.env.VALUE; return { exitCode: 0 }; } });
await shell.exec(`${await prepare("VALUE=changed; export VALUE")}; observe`);
assert.equal(exported, "changed");
const controller = new AbortController();
const reason = new FsError("ENOENT", { path: "cancel-current-shell" });
commands.register({ name: "block", execute(context) { controller.abort(reason); throw context.signal.reason; } });
await assert.rejects(shell.exec(await prepare("block"), { signal: controller.signal }), error => error === reason);
if (mode === "source") {
  await fs.symlink("/lib", "/alias");
  await prepare("VALUE=symlink; export VALUE");
  await shell.exec(". /alias; observe");
  assert.equal(exported, "symlink");
  const stopped = new AbortController();
  const late = new FsError("EACCES", { path: "late" });
  const wrapper = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => new Promise((_, reject) => {
      setTimeout(() => stopped.abort(late), 5);
      setTimeout(() => reject(new Error("late rejection observed")), 15);
    });
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(new Shell({ fs: wrapper }).exec(". /lib", { signal: stopped.signal }), error => error === late);
  await new Promise(resolve => setTimeout(resolve, 30));
  await fs.chmod("/lib", 0);
  assert.notEqual((await shell.exec(". /lib")).exitCode, 0);
  assert.equal((await shell.exec("source -p / lib")).exitCode, 2);
}
console.log(`PASS ${mode} current-state bounds`);
