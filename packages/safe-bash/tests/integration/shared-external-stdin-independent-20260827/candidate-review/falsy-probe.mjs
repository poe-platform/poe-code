import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { setImmediate as turn } from "node:timers/promises";
import { Shell, CommandRegistry, MemoryFileSystem, readBytes } from "virtual-bash";

const rows = [];
const drain = async context => { for await (const chunk of readBytes(context.stdin, context.signal)) await context.stdout.write(chunk); return { exitCode: 0 }; };
for (const boundary of ["direct", "Shell"]) {
  for (const label of ["null", "undefined"]) {
    const reason = label === "null" ? null : undefined;
    const secondary = new Error(`secondary-${boundary}-${label}`);
    let reads = 0, returns = 0;
    const output = [], errors = [];
    const source = { [Symbol.asyncIterator]() { return {
      async next() { reads++; throw reason; },
      async return() { returns++; throw secondary; },
    }; } };
    const instance = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([{ name: "drain", execute: drain }]) });
    const stdout = { async write(bytes) { output.push(Buffer.from(bytes)); } };
    const stderr = { async write(bytes) { errors.push(Buffer.from(bytes)); } };
    const row = { id: `${boundary}-primary-${label}` };
    try {
      const operation = boundary === "direct" ? drain({ stdin: source, stdout, signal: new AbortController().signal }) : instance.exec("drain", { stdin: source, stdout, stderr });
      const result = await operation.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
      row.observed = { ok: result.ok, reason: String(result.error), samePrimary: !result.ok && result.error === reason, exitCode: result.value?.exitCode, reads, returns, stdoutHex: Buffer.concat(output).toString("hex"), stderr: Buffer.concat(errors).toString() };
      assert.equal(reads, 1); assert.equal(returns, 1); assert.equal(Buffer.concat(output).length, 0);
      if (boundary === "direct") { assert.equal(result.ok, false); assert.equal(result.error, reason); assert.equal(Buffer.concat(errors).length, 0); }
      else { assert.equal(result.ok, true); assert.equal(result.value.exitCode, 1); assert.equal(Buffer.concat(errors).toString(), `shell: line 1: ${label}\n`); }
      row.pass = true;
    } catch (error) { row.pass = false; row.failure = { message: error.message, stack: error.stack }; }
    finally { await instance.dispose(); }
    rows.push(row);
  }
}
{
  const row = { id: "Shell-abort-undefined-native-reason" };
  let enteredReturn, rejectReturn;
  const entered = new Promise(resolve => { enteredReturn = resolve; });
  const returning = new Promise((resolve, reject) => { rejectReturn = reject; });
  let reads = 0, returns = 0;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: new Uint8Array() }; },
    return() { returns++; enteredReturn(); return returning; },
  }; } };
  const controller = new AbortController();
  const instance = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([{ name: "idle", execute: () => ({ exitCode: 0 }) }]) });
  const operation = instance.exec("idle", { stdin: source, signal: controller.signal }).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  try {
    await entered;
    controller.abort(undefined);
    const result = await operation;
    row.observed = { ok: result.ok, exactNativeReason: result.error === controller.signal.reason, name: result.error?.name, nativeDOMException: result.error instanceof DOMException, reads, returns };
    assert.equal(result.ok, false); assert.equal(result.error, controller.signal.reason);
    assert.ok(result.error instanceof DOMException); assert.equal(result.error.name, "AbortError"); assert.notEqual(result.error, undefined);
    assert.equal(reads, 0); assert.equal(returns, 1);
    rejectReturn(new Error("falsy-control-late-return")); await turn(); await turn();
    row.pass = true;
  } catch (error) { row.pass = false; row.failure = { message: error.message, stack: error.stack }; }
  finally { rejectReturn(new Error("falsy-control-finally-return")); await operation; await instance.dispose(); }
  rows.push(row);
}
writeFileSync(process.argv[2], JSON.stringify({ label: "explicitly authorized separate postfreeze falsy cohort", rows }, null, 2) + "\n", { flag: "wx" });
assert.ok(rows.every(row => row.pass), JSON.stringify(rows.filter(row => !row.pass)));
