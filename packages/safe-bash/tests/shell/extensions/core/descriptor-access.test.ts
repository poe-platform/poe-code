import assert from "node:assert/strict";
import test from "node:test";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>) {
  const fs = createMemoryFileSystem();
  return { fs, shell: new Shell({ fs, extensions: [{ name: "descriptor-review", create: () => ({ builtins: [{ name: "inspectfd", execute }] }) }] }) };
}

function openValidation(input: ShellExtensionContext["input"]): (descriptor: number) => void {
  const validate = Reflect.get(input, "validateOpen") as unknown;
  assert.equal(typeof validate, "function", "Proposed additive input.validateOpen(fd) is required; readable-only borrow cannot validate open write-only descriptors");
  return (validate as (descriptor: number) => void).bind(input);
}

function badDescriptor(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "EBADF";
}

for (const entry of [
  { name: "missing", script: "inspectfd", descriptor: 9 },
  { name: "closed", script: "inspectfd 3>&-", descriptor: 3 },
  { name: "write-only", script: "inspectfd 3>/output", descriptor: 3 },
  { name: "write-only alias", script: "inspectfd 3>/output 4>&3", descriptor: 4 },
]) test(`borrow compatibility: ${entry.name} remains an immediate EBADF`, async context => {
  const subject = setup(async invocation => {
    assert.throws(() => invocation.input.borrow(entry.descriptor), badDescriptor);
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(entry.script);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const entry of [
  { name: "default input", script: "inspectfd", descriptor: 0, readable: true },
  { name: "default output", script: "inspectfd", descriptor: 1, readable: false },
  { name: "default error", script: "inspectfd", descriptor: 2, readable: false },
  { name: "write-only", script: "inspectfd 3>/output", descriptor: 3, readable: false },
  { name: "write-only alias", script: "inspectfd 3>/output 4>&3", descriptor: 4, readable: false },
  { name: "readable alias", script: "inspectfd 3</input 4<&3", descriptor: 4, readable: true },
]) test(`open validation proposal: ${entry.name} is valid without borrowing or reading`, async context => {
  const subject = setup(async invocation => {
    const validate = openValidation(invocation.input);
    assert.equal(validate(entry.descriptor), undefined);
    assert.equal(validate(entry.descriptor), undefined);
    if (!entry.readable) assert.throws(() => invocation.input.borrow(entry.descriptor), badDescriptor);
    else {
      const lease = invocation.input.borrow(entry.descriptor);
      const record = await lease.record();
      assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10));
      await record.release();
      await lease.release();
    }
    return 0;
  });
  context.after(() => subject.shell.dispose());
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10));
  const result = await subject.shell.exec(entry.script, { stdin: Uint8Array.of(255, 0, 10) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const entry of [
  { name: "missing", script: "inspectfd", descriptor: 9 },
  { name: "closed", script: "inspectfd 3>&-", descriptor: 3 },
  { name: "closed stdin", script: "inspectfd 0<&-", descriptor: 0 },
]) test(`open validation proposal: ${entry.name} fails before caller mutation`, async context => {
  let mutated = false;
  const subject = setup(async invocation => {
    const validate = openValidation(invocation.input);
    assert.throws(() => { validate(entry.descriptor); mutated = true; }, badDescriptor);
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(entry.script);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(mutated, false);
});

test("open validation proposal: malformed numeric descriptors retain RangeError", async context => {
  const subject = setup(async invocation => {
    const validate = openValidation(invocation.input);
    for (const descriptor of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validate(descriptor), RangeError);
      assert.throws(() => invocation.input.borrow(descriptor), RangeError);
    }
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("inspectfd");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("open validation proposal: capability expires with invocation", async context => {
  let escaped: ((descriptor: number) => void) | undefined;
  const subject = setup(async invocation => { escaped = openValidation(invocation.input); escaped(0); return 0; });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("inspectfd");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.throws(() => escaped!(0));
});

test("open validation proposal: validation alone never pulls the input producer", async context => {
  let pulls = 0;
  const subject = setup(async invocation => {
    const validate = openValidation(invocation.input);
    validate(0);
    validate(0);
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("inspectfd", { stdin: { [Symbol.asyncIterator]() { return {
    async next() { pulls++; throw new Error("Validation must not read"); },
  }; } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(pulls, 0);
});

for (const entry of [
  { name: "write-only", suffix: "3>/output", descriptor: 3, expected: ["validated", "cleared", "borrow:EBADF"], status: 0 },
  { name: "missing", suffix: "", descriptor: 9, expected: ["validate:EBADF"], status: 1 },
  { name: "closed", suffix: "3>&-", descriptor: 3, expected: ["validate:EBADF"], status: 1 },
]) test(`generic extension ordering proposal: ${entry.name} validation versus publication and read admission`, async context => {
  const events: string[] = [];
  const subject = setup(async invocation => {
    const validate = openValidation(invocation.input);
    try { validate(entry.descriptor); }
    catch (error) {
      if (!badDescriptor(error)) throw error;
      events.push("validate:EBADF");
      assert.equal(invocation.bindings.get("array", 0), "old");
      return 1;
    }
    events.push("validated");
    const writer = await invocation.bindings.openIndexed("array", { clear: true });
    try {
      assert.equal(invocation.bindings.get("array", 0), undefined);
      events.push("cleared");
      assert.throws(() => invocation.input.borrow(entry.descriptor), badDescriptor);
      events.push("borrow:EBADF");
    } finally { await writer.close(); }
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(`array=(old); inspectfd ${entry.suffix}`);
  assert.deepEqual(events, entry.expected, result.stderr);
  assert.equal(result.exitCode, entry.status, result.stderr);
});

const nativeCases = [
  { name: "write-only admission clears before failed read", command: "mapfile -u3 a 3>/dev/null", output: "status=0,count=0", error: "" },
  { name: "write-only alias", command: "mapfile -u4 a 3>/dev/null 4>&3", output: "status=0,count=0", error: "" },
  { name: "readable EOF", command: "mapfile -u3 a 3</dev/null", output: "status=0,count=0", error: "" },
  { name: "missing descriptor preserves array", command: "mapfile -u9 a", output: "status=1,count=1", error: "shell: line 1: mapfile: 9: invalid file descriptor: Bad file descriptor\n" },
  { name: "closed descriptor preserves array", command: "mapfile -u3 a 3>&-", output: "status=1,count=1", error: "shell: line 1: mapfile: 3: invalid file descriptor: Bad file descriptor\n" },
  { name: "missing earlier -u cannot be rescued", command: "mapfile -u9 -u0 a", output: "status=1,count=1", error: "shell: line 1: mapfile: 9: invalid file descriptor: Bad file descriptor\n" },
  { name: "open write-only earlier -u can be replaced", command: "mapfile -u3 -u0 a 3>/dev/null", output: "status=0,count=1", error: "" },
] as const;

for (const entry of nativeCases) test(`pinned Bash descriptor: ${entry.name}`, nativeOptions(), () => {
  const result = runNative(`a=(old); ${entry.command}; printf 'status=%s,count=%s' "$?" "\${#a[@]}"`, "line\n");
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, Buffer.from(entry.output));
  assert.deepEqual(result.stderr, Buffer.from(entry.error));
});

test("pinned Bash descriptor: read reports write-only failure at read stage", nativeOptions(), () => {
  const result = runNative("read -ru3 value 3>/dev/null; printf 'status=%s' \"$?\"");
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, Buffer.from("status=1"));
  assert.deepEqual(result.stderr, Buffer.from("shell: line 1: read: read error: 3: Bad file descriptor\n"));
});

for (const missing of [false, true]) test(`pinned Bash descriptor: ${missing ? "missing FD precedes" : "write-only FD permits"} invalid-name diagnostic`, nativeOptions(), () => {
  const result = runNative(missing ? "mapfile -u9 $'\\xff'" : "mapfile -u3 $'\\xff' 3>/dev/null");
  assert.equal(result.status, 1);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.deepEqual(result.stderr, missing
    ? Buffer.from("shell: line 1: mapfile: 9: invalid file descriptor: Bad file descriptor\n")
    : Buffer.concat([Buffer.from("shell: line 1: mapfile: `"), Buffer.from([255]), Buffer.from("': not a valid identifier\n")]));
});
