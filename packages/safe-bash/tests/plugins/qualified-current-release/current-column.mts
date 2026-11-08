import assert from "node:assert/strict";
import { Shell, createMemoryFileSystem, type ByteSource, type CommandContext, type InvocationCleanup, type Middleware } from "virtual-bash";
import { columnCommands, createColumnCommand, createColumnCommands, type ColumnCommandsOptions, type ColumnLimits } from "virtual-bash/commands/column";

const limits: Partial<ColumnLimits> = { maxSteps: 1024, maxArgumentBytes: 64, maxRows: 8, maxCells: 8, maxInputBytes: 128, maxOutputBytes: 256, maxDiagnosticBytes: 64 };
const options: ColumnCommandsOptions = { replace: false, limits };
const definition = createColumnCommand(options);
assert.deepEqual(createColumnCommands(options).map(command => command.name), ["column"]);
const fs = createMemoryFileSystem();
const writes: Uint8Array[] = [];
const context: CommandContext = {
  command: "column", args: ["-t"], cwd: "/", env: {}, fs,
  signal: new AbortController().signal,
  stdin: (async function* () { yield new TextEncoder().encode("a b\n"); })(),
  stdout: { async write(bytes) { writes.push(Uint8Array.from(bytes)); } },
  stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
};
assert.equal((await definition.execute(context))?.exitCode ?? 0, 0);
assert.equal(Buffer.concat(writes).toString(), "a  b\n");
let completed = 0;
const middleware: Middleware = async (command, next) => {
  let completion: Promise<void> | undefined;
  const cleanup: InvocationCleanup = () => completion ??= Promise.resolve().then(() => { completed++; });
  command.registerCleanup?.(cleanup);
  try { return await next(); } finally { await cleanup(); }
};
const shell = new Shell({ fs }).use(middleware).use(columnCommands(options));
const input: ByteSource = { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode("a b\n"); } };
try {
  const result = await shell.exec("column -t", { stdin: input });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "a  b\n"); assert.equal(result.stderr, "");
  assert.equal(completed, 1);
  await fs.writeFile("/input", new TextEncoder().encode("left right\n"));
  const redirected = await shell.exec("column -t /input > /output");
  assert.equal(redirected.exitCode, 0); assert.equal(redirected.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "left  right\n");
} finally { await shell.dispose(); }
assert.equal(completed, 2);
