import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { primaryReference } from "./primary-reference.js";

const operands = [
  ["overlong UTF-8 scalar", "$'\\xc0\\xaf'"],
  ["literal replacement scalar", "$'\\xef\\xbf\\xbd'"],
  ["newline and invalid scalar bytes", "$'name\\n\\xff'"],
  ["later invalid scalar bytes", "value $'\\xfe\\xff'"],
  ["UTF-8 option reports its first byte", "-$'\\xc3\\xa9'"],
  ["cluster stops at first invalid option byte", "-r$'\\xff\\xfe'"],
  ["attached count retains both invalid bytes", "-rn$'\\xff\\xfe' value"],
  ["exact count preserves surrounding whitespace", "-rN$' \\xff \\t' value"],
  ["timeout retains invalid fractional byte", "-t$'1.\\xff' value"],
  ["timeout suffix after six fractional digits", "-t$'0.000000\\xff' value"],
  ["timeout suffix after rounding digit", "-t$'0.0000001\\xff' value"],
  ["array name retains newline and invalid bytes", "-ra$'name\\n\\xff'"],
] as const;

for (const [name, args] of operands) test(`diagnostic review native: ${name}`, async context => {
  const source = `value=OLD; values=(KEEP); read ${args}; status=$?; printf 'status:<%s> value:<%s> array:<' "$status" "$value"; printf '<%s>' "\${values[@]}"; printf '>'; read -r rest; printf ' rest:<%s>' "$rest"`;
  const expected = primaryReference("diagnostic-review.test.ts", source, "first word\nremaining\n");
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [readExtension()], limits: { maxWallClockMs: 1500 } });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(source, { stdin: "first word\nremaining\n", env: { LC_ALL: "C" } });
  assert.equal(actual.exitCode, expected.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr);
});

for (const delta of [0, -1]) test(`diagnostic review: usage and prior stdout share one exact byte allowance, delta=${delta}`, async context => {
  const diagnostic = Buffer.concat([Buffer.from("shell: line 1: read: -"), Buffer.from([255]), Buffer.from(": invalid option\n")]);
  const usage = Buffer.from("read: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n");
  const writes: Uint8Array[] = [];
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [readExtension()], limits: { maxOutputBytes: 3 + diagnostic.length + usage.length + delta } });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const execution = shell.exec("printf pre; read -$'\\xff'", { stderr: { async write(bytes) { writes.push(bytes.slice()); } } });
  if (delta === 0) {
    const result = await execution;
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "pre");
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.concat([diagnostic, usage]));
    assert.equal(writes.length, 2);
  } else {
    await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(Buffer.concat(writes), diagnostic);
    assert.equal(writes.length, 1);
  }
});

for (const maximum of [640, 1024]) test(`diagnostic review: raw diagnostic participates in expansion admission, limit=${maximum}`, async context => {
  let entered = 0; let diagnostics = 0; let writes = 0;
  const definition = readExtension();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxExpansionBytes: maximum }, extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(command) {
      entered++;
      return builtin.execute({ ...command, async diagnostic(message) { diagnostics++; await command.diagnostic(message); } });
    } })) };
  } }] });
  context.after(() => shell.dispose());
  const execution = shell.exec("read -n $'\\xff'", { stderr: { async write() { writes++; } } });
  if (maximum === 640) {
    await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    assert.equal(writes, 0);
  } else {
    assert.equal((await execution).exitCode, 1);
    assert.equal(writes, 1);
  }
  assert.equal(entered, 1);
  assert.equal(diagnostics, 1);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function intercept<Target extends object>(subject: Target, overrides: Partial<Target>): Target {
  return new Proxy(subject, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

for (const cancel of [false, true]) for (const reason of [false, 0, "", null]) test(`diagnostic review: ${cancel ? "root cancellation" : "leaf stderr failure"} drains actual owned input (${String(reason)})`, { timeout: 2500 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("unread\n"));
  const closing = deferred();
  const release = deferred();
  const controller = new AbortController();
  let reads = 0; let closes = 0;
  let observed: { failure: unknown } | undefined;
  const writes: Uint8Array[] = [];
  const fs = intercept(memory, { async open(path, options) {
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, {
      async read(...args) { reads++; return descriptor.read(...args); },
      async close() { closes++; closing.resolve(); await release.promise; await descriptor.close(); },
    });
  } });
  const definition = readExtension();
  const shell = new Shell({ fs, limits: { maxWallClockMs: 1500 }, extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, async execute(command) {
      if (cancel) return builtin.execute(command);
      try { return await builtin.execute(command); }
      catch (failure) { observed = { failure }; return 0; }
    } })) };
  } }] });
  context.after(async () => { release.resolve(); controller.abort(reason); await shell.dispose(); });
  let settled = false;
  const outcome = shell.exec("read -u0 -n $'\\xff' </input", { signal: controller.signal, stderr: { async write(bytes) {
    writes.push(bytes.slice());
    if (cancel) controller.abort(reason);
    else throw reason;
  } } }).then(result => ({ result }), failure => ({ failure })).finally(() => { settled = true; });
  try {
    await closing.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { release.resolve(); }
  const actual = await outcome;
  if (cancel) {
    assert.ok("failure" in actual);
    assert.equal(actual.failure, reason);
  } else {
    assert.ok("result" in actual);
    assert.equal(actual.result.exitCode, 0);
    assert.ok(observed);
    assert.equal(observed.failure, reason);
  }
  assert.equal(reads, 0);
  assert.equal(closes, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(Buffer.concat(writes), Buffer.concat([Buffer.from("shell: line 1: read: "), Buffer.from([255]), Buffer.from(": invalid number\n")]));
});
