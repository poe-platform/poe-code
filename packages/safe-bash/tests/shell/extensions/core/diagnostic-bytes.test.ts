import assert from "node:assert/strict";
import test from "node:test";
import { concatShellValues, type ShellValue } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError, type ShellLimits } from "../../../../src/shell/types.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>, limits: ShellLimits = {}) {
  const fs = createMemoryFileSystem();
  return { fs, shell: new Shell({ fs, limits, extensions: [{ name: "diagnostic-review", create: () => ({ builtins: [{ name: "report", execute }] }) }] }) };
}

for (const entry of [
  { name: "string compatibility", argument: "plain", bytes: Buffer.from("plain") },
  { name: "raw FF", argument: "$'\\xff'", bytes: Buffer.from([255]) },
  { name: "distinct malformed UTF-8", argument: "$'\\x80\\xfe\\xff'", bytes: Buffer.from([128, 254, 255]) },
  { name: "valid non-ASCII", argument: "'é'", bytes: Buffer.from("é") },
]) test(`canonical diagnostic: ${entry.name} retains bytes and runtime line prefix`, async context => {
  const subject = setup(async invocation => {
    const diagnostic = invocation.diagnostic as (message: ShellValue) => Promise<void>;
    await diagnostic(invocation.argumentValues[0]!);
    return 1;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(`:\nreport ${entry.argument}`);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.concat([Buffer.from("shell: line 2: "), entry.bytes, Buffer.from("\n")]));
});

test("canonical diagnostic: composite identifier bytes survive stderr aliasing", async context => {
  const subject = setup(async invocation => {
    const diagnostic = invocation.diagnostic as (message: ShellValue) => Promise<void>;
    await diagnostic(concatShellValues(["report: `", invocation.argumentValues[0]!, "': not a valid identifier"]));
    return 1;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("report $'\\xff' 2>&1");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from("shell: line 1: report: `"), Buffer.from([255]), Buffer.from("': not a valid identifier\n")]));
});

test("canonical diagnostic: memory-file stderr receives canonical bytes", async context => {
  const subject = setup(async invocation => {
    const diagnostic = invocation.diagnostic as (message: ShellValue) => Promise<void>;
    await diagnostic(invocation.argumentValues[0]!);
    return 1;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("report $'\\xff' 2>/diagnostic");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(Buffer.from(await subject.fs.readFile("/diagnostic")), Buffer.concat([Buffer.from("shell: line 1: "), Buffer.from([255, 10])]));
});

test("canonical diagnostic: exact byte budget includes prefix and newline, not object display", async context => {
  const subject = setup(async invocation => {
    const diagnostic = invocation.diagnostic as (message: ShellValue) => Promise<void>;
    await diagnostic(invocation.argumentValues[0]!);
    return 1;
  }, { maxOutputBytes: 17 });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("report $'\\xff'");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.concat([Buffer.from("shell: line 1: "), Buffer.from([255, 10])]));
});

test("canonical diagnostic: shared stdout and diagnostic output cannot exceed byte budget", async context => {
  const subject = setup(async invocation => {
    await invocation.stdout.write(Uint8Array.of(65));
    const diagnostic = invocation.diagnostic as (message: ShellValue) => Promise<void>;
    await diagnostic(invocation.argumentValues[0]!);
    return 1;
  }, { maxOutputBytes: 17 });
  context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec("report $'\\xff'"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

test("canonical diagnostic: string-only caller keeps shared output-budget rejection", async context => {
  const subject = setup(async invocation => { await invocation.diagnostic("x"); return 1; }, { maxOutputBytes: 16 });
  context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec("report"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

for (const reason of [false, 0, "", null]) test(`canonical diagnostic: preserves falsey root cancellation ${String(reason)}`, async context => {
  const controller = new AbortController();
  let writes = 0;
  const subject = setup(async invocation => {
    controller.abort(reason);
    const diagnostic = invocation.diagnostic as (message: ShellValue) => Promise<void>;
    await diagnostic(invocation.argumentValues[0]!);
    return 1;
  });
  context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec("report $'\\xff'", { signal: controller.signal, stderr: { write: async () => { writes++; } } }), error => Object.is(error, reason));
  assert.equal(writes, 0);
});

for (const line of [1, 2]) test(`pinned Bash diagnostic: raw invalid identifier at line ${line}`, nativeOptions(), () => {
  const result = runNative(`${line === 2 ? ":\n" : ""}mapfile $'\\xff'`);
  assert.equal(result.status, 1);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(result.stderr, Buffer.concat([Buffer.from(`shell: line ${line}: mapfile: \``), Buffer.from([255]), Buffer.from("': not a valid identifier\n")]));
});
