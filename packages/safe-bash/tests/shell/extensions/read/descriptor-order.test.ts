import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { streamCommands } from "../../../../src/commands/streams.js";
import { FsError } from "../../../../src/contracts/errors.js";
import { createDeviceFileSystem } from "../../../../src/fs/devices/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../../src/fs/mount/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

interface Expected {
  status: number;
  value: string;
  count: number;
  array: string;
  tail: string;
  stderr: string;
}

interface ReadCase {
  name: string;
  args: string;
  before?: string;
  expected: Partial<Expected>;
  pipe?: Partial<Expected>;
}

const readError = "shell: line 1: read: 3: read error: Bad file descriptor\n";
const missingError = "shell: line 1: read: 9: invalid file descriptor: Bad file descriptor\n";
const nameError = "shell: line 1: read: `bad-name': not a valid identifier\n";
const input = "first word\nsecond tail\n";
const cases: readonly ReadCase[] = [
  { name: "ordinary scalar read error preserves assignment", args: "-u3 value", expected: { stderr: readError } },
  { name: "ordinary array read error preserves cells", args: "-u3 -a values", expected: { stderr: readError } },
  { name: "later readable -u replaces open write-only -u", args: "-u3 -u0 value", expected: { status: 0, value: "first word", tail: "second tail" } },
  { name: "later write-only -u selects read-stage failure", args: "-u0 -u3 value", expected: { stderr: readError } },
  { name: "missing earlier -u cannot be replaced", args: "-u9 -u3 value", expected: { stderr: missingError } },
  { name: "missing later -u precedes all assignment", args: "-u3 -u9 value", expected: { stderr: missingError } },
  { name: "zero count assigns empty scalar despite failed access", args: "-u3 -n0 value", expected: { value: "" } },
  { name: "zero exact count clears array despite failed access", args: "-u3 -N0 -a values", expected: { count: 0, array: "" } },
  { name: "zero count validates scalar target", args: "-u3 -n0 bad-name", expected: { stderr: nameError } },
  { name: "zero exact count validates array target", args: "-u3 -N0 -a bad-name", expected: { stderr: nameError } },
  { name: "zero count diagnoses readonly scalar", before: "readonly fixed;", args: "-u3 -n0 fixed", expected: { stderr: "shell: line 1: fixed: readonly variable\n" } },
  { name: "zero exact count diagnoses readonly array", before: "readonly -a values;", args: "-u3 -N0 -a values", expected: { stderr: "shell: line 1: values: readonly variable\n" } },
  { name: "readiness does not assign scalar", args: "-t0 -u3 value", expected: { status: 0 }, pipe: { status: 1 } },
  { name: "readiness bypasses invalid scalar", args: "-t0 -u3 bad-name", expected: { status: 0 }, pipe: { status: 1 } },
  { name: "readiness bypasses readonly scalar", before: "readonly fixed;", args: "-t0 -u3 fixed", expected: { status: 0 }, pipe: { status: 1 } },
  { name: "readiness preserves array", args: "-t0 -u3 -a values", expected: { status: 0 }, pipe: { status: 1 } },
  { name: "readiness bypasses invalid array", args: "-t0 -u3 -a bad-name", expected: { status: 0 }, pipe: { status: 1 } },
  { name: "readiness precedes zero count", args: "-t0 -u3 -n0 value", expected: { status: 0 }, pipe: { status: 1 } },
  { name: "readiness after zero exact count still wins", args: "-N0 -u3 -t0 -a values", expected: { status: 0 }, pipe: { status: 1 } },
  { name: "positive timeout then scalar assignment", args: "-t.02 -u3 value", expected: { stderr: readError }, pipe: { status: 142, value: "", stderr: "" } },
  { name: "positive TMOUT then array clearing", before: "TMOUT=.02;", args: "-u3 -a values", expected: { stderr: readError }, pipe: { status: 142, count: 0, array: "", stderr: "" } },
  { name: "positive timeout then readonly scalar validation", before: "readonly fixed;", args: "-t.02 -u3 fixed", expected: { stderr: readError }, pipe: { stderr: "shell: line 1: fixed: readonly variable\n" } },
  { name: "positive timeout then invalid array validation", args: "-t.02 -u3 -a bad-name", expected: { stderr: readError }, pipe: { stderr: nameError } },
];

function setup(extensions: readonly ShellExtension[] = [readExtension(), arraysExtension()]) {
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } });
  const shell = new Shell({ fs, extensions, limits: { maxWallClockMs: 2000, maxInputBytes: 4096, maxOutputBytes: 65536, maxCommands: 64 } });
  for (const command of [...basicCommands(), ...streamCommands()]) shell.register(command);
  return { shell, fs };
}

function body(entry: ReadCase): string {
  return `value=OLD; fixed=LOCK; values=(KEEP STAY); ${entry.before ?? ""} read -r ${entry.args}; result=$?; printf 'read=%s value=<%s> fixed=<%s> count=%s array=<%s>;' "$result" "$value" "$fixed" "\${#values[@]}" "\${values[*]}"; IFS= read -r tail; printf 'next=%s:<%s>' "$?" "$tail"`;
}

function pipe(bodySource: string): string {
  return `{ { ${bodySource}; } 3>&1 1>&4 | cat; } 4>&1`;
}

function nativeReference(script: string, pipeSource = false) {
  const source = pipeSource
    ? `cat() { local chunk; while IFS= read -r chunk; do printf '%s\\n' "$chunk"; done; }; ${pipe(`[[ -p /dev/fd/3 ]] || exit 97; ${script}`)}`
    : script;
  return { ...primaryReference("descriptor-order.test.ts", source, input), source };
}

function expected(patch: Partial<Expected>) {
  const value: Expected = { status: 1, value: "OLD", count: 2, array: "KEEP STAY", tail: "first word", stderr: "", ...patch };
  return {
    stdout: Buffer.from(`read=${value.status} value=<${value.value}> fixed=<LOCK> count=${value.count} array=<${value.array}>;next=0:<${value.tail}>`),
    stderr: Buffer.from(value.stderr),
  };
}

for (const profile of ["null", "pipe"] as const) for (const entry of cases) {
  test(`descriptor order native/${profile}: ${entry.name}`, async context => {
    const source = profile === "pipe" ? pipe(body(entry)) : `{ ${body(entry)}; } 3>/dev/null`;
    const oracle = nativeReference(profile === "pipe" ? body(entry) : source, profile === "pipe");
    const capture = expected({ ...entry.expected, ...(profile === "pipe" ? entry.pipe : {}) });
    assert.equal(oracle.status, 0);
    assert.deepEqual(oracle.stdout, capture.stdout);
    assert.deepEqual(oracle.stderr, capture.stderr);
    const subject = setup();
    context.after(() => subject.shell.dispose());
    assert.equal((await subject.fs.stat("/dev/null")).type, "character");
    const actual = await subject.shell.exec(source, { stdin: Buffer.from(input), env: { LC_ALL: "C" } });
    context.diagnostic(JSON.stringify({ source, nativeSource: oracle.source,
      native: { status: oracle.status, stdoutHex: oracle.stdout.toString("hex"), stderrHex: oracle.stderr.toString("hex") },
      actual: { status: actual.exitCode, stdoutHex: Buffer.from(actual.stdoutBytes).toString("hex"), stderrHex: Buffer.from(actual.stderrBytes).toString("hex") },
    }));
    assert.equal(actual.exitCode, oracle.status);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), oracle.stdout);
    assert.deepEqual(Buffer.from(actual.stderrBytes), oracle.stderr);
  });
}

const regularCases: readonly ReadCase[] = [
  { name: "ordinary failure retains scalar", args: "-u3 value", expected: { stderr: readError } },
  { name: "zero-timeout bypasses invalid name", args: "-t0 -u3 bad-name", expected: { status: 0 } },
  { name: "readiness precedes zero count", args: "-t0 -u3 -n0 value", expected: { status: 0 } },
  { name: "positive timeout retains read-error behavior", args: "-t.02 -u3 value", expected: { stderr: readError } },
  { name: "zero count assigns empty scalar", args: "-n0 -u3 value", expected: { value: "" } },
  { name: "zero exact count clears array", args: "-N0 -u3 -a values", expected: { count: 0, array: "" } },
];

for (const entry of regularCases) test(`descriptor order VFS regular/recorded ad-hoc profile: ${entry.name}`, async context => {
  const subject = setup();
  context.after(() => subject.shell.dispose());
  await subject.fs.writeFile("/regular", Buffer.from("seed\n"));
  assert.equal((await subject.fs.stat("/regular")).type, "file");
  const source = `{ ${body(entry)}; } 3>>/regular`;
  const actual = await subject.shell.exec(source, { stdin: Buffer.from(input), env: { LC_ALL: "C" } });
  const capture = expected(entry.expected);
  context.diagnostic(JSON.stringify({ source, qualification: "Recorded ad-hoc Bash 5.2.37 regular-file observations; no native regular file is opened by this test",
    nativeEvidenceSha256: "a5786da306c7b3d29e27ea0c3bb656a10f152bf803595624bef85bc5b3e4bf15",
    stdoutHex: Buffer.from(actual.stdoutBytes).toString("hex"), stderrHex: Buffer.from(actual.stderrBytes).toString("hex"),
  }));
  assert.equal(actual.exitCode, 0);
  assert.deepEqual(Buffer.from(await subject.fs.readFile("/regular")), Buffer.from("seed\n"));
  assert.deepEqual(Buffer.from(actual.stdoutBytes), capture.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), capture.stderr);
});

for (const entry of [
  { args: "-u3 -u0 value", redirect: "3<&0", events: ["validate:3", "validate:0", "borrow:0"] },
  { args: "-u3 -u0 value", redirect: "3>/dev/null", events: ["validate:3", "validate:0", "borrow:0"] },
  { args: "-u9 -u0 value", redirect: "", events: ["validate:9"] },
  { args: "-u0 -u9 value", redirect: "", events: ["validate:0", "validate:9"] },
]) test(`descriptor order public hooks validate each option and borrow final only: ${entry.args} ${entry.redirect}`, async context => {
  const events: string[] = [];
  const definition = readExtension();
  const subject = setup([{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      const input = invocation.input;
      return builtin.execute({ ...invocation, input: {
        observe: input.observe.bind(input),
        validateOpen(descriptor) { events.push(`validate:${descriptor}`); input.validateOpen(descriptor); },
        borrow(descriptor) { events.push(`borrow:${descriptor}`); return input.borrow(descriptor); },
      } });
    } })) };
  } }]);
  context.after(() => subject.shell.dispose());
  await subject.shell.exec(`read ${entry.args} ${entry.redirect}`, { stdin: Buffer.from(input) });
  assert.deepEqual(events, entry.events);
});

test("descriptor topology frozen primary: FD3 is a shell-created pipe and FD1 preserves saved output", () => {
  const result = nativeReference("printf 'pipe\\n' >&3; printf 'saved\\n'", true);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stderr, Buffer.alloc(0));
  assert.deepEqual(result.stdout.toString().trimEnd().split("\n").sort(), ["pipe", "saved"]);
});

test("descriptor topology VFS: output-only FD3 feeds cat while FD1 preserves saved output", async context => {
  let checked = 0;
  const subject = setup([readExtension(), { name: "descriptor-topology", create: () => ({ builtins: [{ name: "checkfd", execute(invocation) {
    for (const descriptor of [3, 4]) {
      invocation.input.validateOpen(descriptor);
      assert.throws(() => invocation.input.borrow(descriptor), reason => reason instanceof FsError && reason.code === "EBADF");
    }
    checked++;
    return 0;
  } }] }) }]);
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(pipe("checkfd; printf 'pipe\\n' >&3; printf 'saved\\n'"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(checked, 1);
  assert.deepEqual(result.stdout.split("\n").filter(Boolean).sort(), ["pipe", "saved"]);
});

test("descriptor timing frozen primary: blocked write-pipe readiness is followed by timeout assignment", () => {
  const result = nativeReference('value=OLD; read -t0 -u3 value; printf "ready=%s:<%s>;" "$?" "$value"; read -t.02 -u3 value; printf "timed=%s:<%s>" "$?" "$value"', true);
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, Buffer.from("ready=1:<OLD>;timed=142:<>"));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
});
