import { Budget } from "safe-bash-query-engine/limits";
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createJqCommand } from "./index.js";

async function run(command: CommandDefinition, fs: ReturnType<typeof createMemoryFileSystem>, args: string[], env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "", charges = 0;
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env, fs,
    _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
    _chargeFastFsOp() { charges++; },
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: {
      _scratch4k: new Uint8Array(4096),
      writeSync(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); return true; },
      writeRangeSync(bytes: Uint8Array, length: number) { stdout += new TextDecoder().decode(bytes.subarray(0, length)); return true; },
      async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); },
    },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  } as Parameters<CommandDefinition["execute"]>[0]);
  return { ...result, stdout, stderr, charges };
}
const bytes = (text: string) => new TextEncoder().encode(text);

for (const nested of [false, true]) for (const condition of [".active == true", ".active"]) test(`select preserves ${condition} semantics across repeated file runs (nested=${nested})`, async () => {
  const fs = createMemoryFileSystem();
  const active = nested ? [true, [], {}, false, null, undefined] : [true, 1, 0, "true", "", false, null, undefined];
  await fs.writeFile("/items", bytes(active.map((value, id) => JSON.stringify({ id, active: value, padding: "x".repeat(80) })).join("\n") + "\n"));
  const expected = (condition.includes("==") ? [0] : nested ? [0, 1, 2] : [0, 1, 2, 3, 4]).map(id => JSON.stringify({ id }) + "\n").join("");
  const command = createJqCommand();
  for (let i = 0; i < 3; i++) {
    const result = await run(command, fs, ["-c", `select(${condition}) | {id}`, "/items"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

for (const decline of [false, true]) test(`fast execution releases its budget and signal, decline=${decline}`, { skip: !globalThis.gc }, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/items", bytes('{"id":1,"active":true,"padding":"' + "x".repeat(80) + '"}\n'));
  const command = createJqCommand();
  const captured: WeakRef<object>[] = [];
  const original = Budget.prototype.needsYield;
  const mocked = context.mock.method(Budget.prototype, "needsYield", function (this: Budget, checkTime?: boolean) {
    if (captured.length === 0) {
      captured.push(new WeakRef(this), new WeakRef(this.signal));
      if (decline) return true;
    }
    return original.call(this, checkTime);
  });
  const result = await run(command, fs, ["-c", "select(.active) | {id}", "/items"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '{"id":1}\n');
  assert.ok(captured[0]);
  mocked.mock.resetCalls();
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
    globalThis.gc!();
  }
  assert.deepEqual(captured.map(ref => ref.deref()), [undefined, undefined]);
});

for (const asyncOptions of [false, true]) test(`unary filters (async options=${asyncOptions})`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/argument", bytes("value"));
  const command = createJqCommand();
  const prefix = asyncOptions ? ["--rawfile", "unused", "/argument"] : [];
  await fs.writeFile("/input", bytes('{"a":3}\n'));
  const field = await run(command, fs, [...prefix, "-c", "-.a", "/input"]);
  assert.equal(field.exitCode, 0, field.stderr);
  assert.equal(field.stdout, "-3\n");
  const invalid = await run(command, fs, [...prefix, "-cn", "--unknown"]);
  assert.equal(invalid.exitCode, 2);
  for (const [filter, expected] of [["-5", "-5"], ["-(1+2)", "-3"], ["-[1,2][0]", "-1"], ["-(0)", "-0"]]) {
    const result = await run(command, fs, [...prefix, "-cn", filter!]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected + "\n");
  }
});
for (const asyncOptions of [false, true]) test(`environment access (async options=${asyncOptions})`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/argument", bytes("value"));
  const command = createJqCommand();
  const prefix = asyncOptions ? ["--rawfile", "unused", "/argument"] : [];
  for (const value of ["first", "second"]) {
    const result = await run(command, fs, [...prefix, "-cn", '[env.FOO, $ENV.FOO, (def read: env.FOO; read), (def read: $ENV.FOO; read)]'], {FOO: value});
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, JSON.stringify([value,value,value,value]) + "\n");
  }
  const shadowed = await run(command, fs, [...prefix, "-cn", 'def env: "custom"; [env, $ENV.FOO, ("local" as $ENV | $ENV)]'], {FOO: "context"});
  assert.equal(shadowed.stdout, '["custom","context","local"]\n');
  const empty = await run(command, fs, [...prefix, "-cn", '[env, $ENV]']);
  assert.equal(empty.stdout, '[{},{}]\n');
  const override = await run(command, fs, [...prefix, "-cn", "--arg", "ENV", "override", '[env.FOO, $ENV]'], {FOO: "context"});
  assert.equal(override.stdout, '["context","override"]\n');
});

for (const filter of ["env", "$ENV"]) test(`${filter} enforces environment resource limits`, async () => {
  const fs = createMemoryFileSystem();
  const env = {FOO: "x".repeat(100)};
  const result = await run(createJqCommand({limits: {maxValueBytes: 20}}), fs, ["-cn", filter], env);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("maxValueBytes"));
  const collection = await run(createJqCommand({limits: {maxCollectionSize: 2}}), fs, ["-cn", filter], {A: "a", B: "b", C: "c"});
  assert.notEqual(collection.exitCode, 0);
  assert.ok(collection.stderr.includes("maxCollectionSize"));
});
