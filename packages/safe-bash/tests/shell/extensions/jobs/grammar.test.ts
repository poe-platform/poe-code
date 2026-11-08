import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { grammarJobReference } from "./grammar53-reference.js";

function pidDiagnostics(pid: string) {
  assert.ok(pid.length > 0 && pid[0] !== "0" && [...pid].every(character => character >= "0" && character <= "9"));
  return Buffer.from(["+", " ", "-"].map(prefix => `shell: line 1: wait: \`${prefix}${pid}': not a pid or valid job spec\n`).join(""));
}

function mappedPidDiagnostics(native: Buffer, observed: string) {
  const prefix = Buffer.from("shell: line 1: wait: `+");
  const suffix = Buffer.from("': not a pid or valid job spec\n");
  assert.deepEqual(native.subarray(0, prefix.length), prefix);
  const end = native.indexOf(suffix, prefix.length);
  assert.ok(end > prefix.length);
  const nativePid = native.subarray(prefix.length, end).toString("ascii");
  assert.equal(nativePid, "81836");
  assert.deepEqual(native, pidDiagnostics(nativePid));
  return pidDiagnostics(observed);
}

for (let id = 1; id <= 8; id++) {
  const reference = grammarJobReference(id);
  test(`authenticated Bash 5.3 wait grammar ${id}: ${reference.name}`, async context => {
    const observed: string[] = [];
    const definition = jobsExtension();
    const extension = id === 1 ? { ...definition, create() {
      const instance = definition.create();
      return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation: ShellExtensionContext) {
        const child = invocation.variable("child");
        assert.ok(child);
        observed.push(child);
        return builtin.execute.call(builtin, invocation);
      } })) };
    } } : definition;
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension], env: { LC_ALL: "C" },
      limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 },
    });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(reference.source, { stdin: reference.stdin });
    assert.equal(result.exitCode, reference.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
    if (id === 1) {
      assert.equal(observed.length, 4);
      assert.equal(new Set(observed).size, 1);
      assert.deepEqual(Buffer.from(result.stderrBytes), mappedPidDiagnostics(reference.stderr, observed[0]!));
    } else assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
  });
}

test("case1 PID mapping rejects line, prefix, count and cross-line identity changes", () => {
  const original = grammarJobReference(1).stderr;
  assert.deepEqual(mappedPidDiagnostics(original, "1001"), pidDiagnostics("1001"));
  for (const changed of [
    Buffer.from(original.toString().replace("line 1", "line 2")),
    Buffer.from(original.toString().replace("`+", "`-")),
    original.subarray(0, original.length - 1),
    Buffer.from(original.toString().replace(" 81836", " 81837")),
  ]) assert.throws(() => mappedPidDiagnostics(changed, "1001"));
});

for (const flags of ["-f", "-ff -f --"]) {
  test(`termination-only profile control: ${flags} retains child status and bare wait`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(`{ exit 7; } & child=$!; wait ${flags} "$child"; printf 'child:%s\n' "$?"; wait ${flags}; printf 'bare:%s\n' "$?"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "child:7\nbare:0\n");
    assert.equal(result.stderr, "");
  });
}

for (const operand of [{ source: "$'1\\t2'", bytes: Buffer.from("1\t2") }, { source: "$'1\\xa0'", bytes: Buffer.from([49, 160]) }]) {
  test(`source-backed numeric boundary control: ${operand.source} stops before later operand`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()], env: { LC_ALL: "C" } });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(`wait ${operand.source} 0; printf '%s' "$?"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1");
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.concat([
      Buffer.from("shell: line 1: wait: `"), operand.bytes, Buffer.from("': not a pid or valid job spec\n"),
    ]));
  });
}
