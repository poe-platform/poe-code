import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./primary-reference.js";

interface DiagnosticCase {
  readonly name: string;
  readonly args: string;
  readonly status?: number;
  readonly next?: string;
  readonly value?: string;
  readonly array?: string;
  readonly raw?: boolean;
}

const cases: DiagnosticCase[] = [
  { name: "scalar name refuses before input", args: "$'\\xff'" },
  { name: "second scalar name refuses after earlier assignment", args: "value $'\\xff'", value: "first", next: "second tail" },
  { name: "scalar name after option terminator", args: "-- $'\\xff'" },
  { name: "scalar name from byte-valued variable", args: '"$bad"' },
  { name: "array name refuses after consuming record", args: "-a $'\\xff'", next: "second tail" },
  { name: "attached array name", args: "-a$'\\xff'", next: "second tail" },
  { name: "later valid array replaces earlier invalid name", args: "-a$'\\xff' -a values", status: 0, array: "first,word,", next: "second tail", raw: false },
  { name: "later invalid array preserves existing array", args: "-a values -a$'\\xff'", next: "second tail" },
  { name: "readiness bypasses invalid scalar without assignment", args: "-t0 $'\\xff'", status: 0, raw: false },
  { name: "readiness bypasses invalid array without clearing", args: "-t0 -a$'\\xff'", status: 0, raw: false },
  { name: "invalid descriptor precedes invalid scalar", args: "-u9 $'\\xff'", raw: false },
  { name: "invalid first scalar precedes distinct invalid array", args: "-a$'\\xfe' $'\\xff'" },
  { name: "hex count diagnostic retains suffix byte", args: "-n $'0x\\xff' value" },
  { name: "raw invalid option and usage", args: "-$'\\xff' value", status: 2 },
  { name: "attached operand after clustered raw flag", args: "-rn$'\\xff' value" },
  { name: "signed invalid count preserves the full operand", args: "-n $'-\\xff' value" },
  { name: "first raw numeric error wins over distinct later byte", args: "-n$'\\xff' -n$'\\xfe' value" },
  { name: "zero timeout does not mask invalid descriptor operand", args: "-t0 -u$'\\xff' value" },
];

for (const [flag, valid] of [["u", "0"], ["t", "1"], ["n", "1"], ["N", "1"]] as const) {
  cases.push(
    { name: `separated -${flag} operand`, args: `-${flag} $'\\xff' value` },
    { name: `attached -${flag} operand`, args: `-${flag}$'\\xff' value` },
    { name: `invalid -${flag} is not repaired by later valid operand`, args: `-${flag}$'\\xff' -${flag}${valid} value` },
    { name: `later invalid -${flag} retains its original operand`, args: `-${flag}${valid} -${flag}$'\\xff' value` },
  );
}

for (const entry of cases) {
  test(`read byte diagnostics: ${entry.name}`, async context => {
    const source = `bad=$'\\xff'; value=OLD; values=(KEEP STAY); read ${entry.args}; status=$?; printf 'read:%s value:<%s> array:<' "$status" "$value"; printf '%s,' "\${values[@]}"; printf '>;'; read -r tail; printf 'next:%s:<%s>' "$?" "$tail"`;
    const expected = primaryReference("diagnostic-bytes.test.ts", source, "first word\nsecond tail\n");
    const shell = new Shell({
      fs: createMemoryFileSystem(),
      extensions: [readExtension()],
      limits: { maxWallClockMs: 2000, maxInputBytes: 4096, maxOutputBytes: 65536, maxCommands: 64 },
    });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const actual = await shell.exec(source, { stdin: Buffer.from("first word\nsecond tail\n"), env: { LC_ALL: "C" } });
    context.diagnostic(JSON.stringify({
      source,
      native: { status: expected.status, stdoutHex: expected.stdout.toString("hex"), stderrHex: expected.stderr.toString("hex") },
      actual: { status: actual.exitCode, stdoutHex: Buffer.from(actual.stdoutBytes).toString("hex"), stderrHex: Buffer.from(actual.stderrBytes).toString("hex") },
    }));
    assert.equal(expected.status, 0);
    assert.deepEqual(expected.stdout, Buffer.from(`read:${entry.status ?? 1} value:<${entry.value ?? "OLD"}> array:<${entry.array ?? "KEEP,STAY,"}>;next:0:<${entry.next ?? "first word"}>`));
    assert.equal(expected.stderr.includes(255), entry.raw ?? true);
    assert.equal(expected.stderr.includes(254), false);
    assert.equal(actual.exitCode, expected.status);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr);
  });
}
