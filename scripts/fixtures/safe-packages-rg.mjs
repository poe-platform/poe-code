import assert from "node:assert/strict";
import { Shell, baseAgentCommands, createMemoryFileSystem, createRgCommand as rootFactory, FsError, createCommandArguments, getCommandArguments, toByteSource } from "@poe-platform/safe-bash";
import { createNodeRegexProvider } from "@poe-platform/safe-bash/node";
import { createRgCommand, rgCommands } from "@poe-platform/safe-bash/commands/rg";
import { FsError as contractError, createCommandArguments as contractArguments } from "@poe-platform/safe-bash/contracts";

assert.equal(rootFactory, createRgCommand);
assert.equal(FsError, contractError);
assert.equal(createCommandArguments, contractArguments);
const fs = createMemoryFileSystem();
await fs.mkdir("/src");
await fs.writeFile("/src/a.ts", new TextEncoder().encode("needle\nother\n"));
await fs.writeFile("/src/b.js", new TextEncoder().encode("needle\n"));
await fs.writeFile("/run.sh", new TextEncoder().encode("rg -t ts -n needle /src | cat\n"));
const shell = new Shell({ fs }).use(baseAgentCommands());
try {
  await shell.exec("true");
  assert.ok(shell.commands.has("rg"));
  const host = { commands: shell.commands };
  assert.throws(() => rgCommands().setup(host), /already registered/);
  rgCommands({ replace: true }).setup(host);
  const result = await shell.exec("sh /run.sh");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "/src/a.ts:1:needle\n");
  const piped = await shell.exec("printf 'needle\nother\n' | rg needle");
  assert.equal(piped.stdout, "needle\n");
  assert.equal(piped.exitCode, 0);
  let observed;
  shell.use(async (context, next) => {
    if (context.command === "rg") observed = getCommandArguments(context).bytes(1);
    return next();
  });
  const raw = await shell.exec("printf '\\377' | rg -aF \"$(printf '\\377')\"");
  assert.equal(raw.exitCode, 0, raw.stderr);
  assert.deepEqual([...observed], [255]);
  assert.deepEqual([...raw.stdoutBytes], [255, 10]);
} finally { await shell.dispose(); }

const carrier = createCommandArguments(["needle", "-"]);
const reason = new Error("cancel packed rg");
const controller = new AbortController();
controller.abort(reason);
const context = {
  command: "rg", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
  stdin: toByteSource("needle\n"), signal: controller.signal,
  stdout: { async write() {} }, stderr: { async write() {} },
};
await assert.rejects(async () => createRgCommand().execute(context), error => error === reason);
let diagnostic = "";
const limited = await createRgCommand({ maxOutputBytes: 1 }).execute({
  ...context, signal: new AbortController().signal,
  stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
});
assert.equal(limited.exitCode, 2);
assert.match(diagnostic, /limit/);

const nativeShell = new Shell({ fs }).use(baseAgentCommands({ regexExecutor: createNodeRegexProvider() }));
try {
  const result = await nativeShell.exec("rg -t ts needle /src");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "/src/a.ts:needle\n");
} finally { await nativeShell.dispose(); }

const denied = new FsError("EACCES", { path: "/src/a.ts" });
const failingFs = new Proxy(fs, {
  get(target, key) {
    if (key === "readFile") return async () => { throw denied; };
    if (key === "readStream") return async function* () { yield await Promise.reject(denied); };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const fileCarrier = createCommandArguments(["needle", "/src/a.ts"]);
let failureOutput = "";
const failure = await createRgCommand().execute({
  ...context, fs: failingFs, args: fileCarrier.args, argumentValues: fileCarrier,
  signal: new AbortController().signal,
  stderr: { async write(bytes) { failureOutput += new TextDecoder().decode(bytes); } },
});
assert.equal(failure.exitCode, 2);
assert.match(failureOutput, /EACCES/);
