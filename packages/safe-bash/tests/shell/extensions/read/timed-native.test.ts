import assert from "node:assert/strict";
import test from "node:test";
import { primaryReference } from "./primary-reference.js";

const initial = "value=OLD; REPLY=ROLD; values=(old keep);";
const snapshot = `printf 'status=%s;value=<%s>;reply=<%s>;array=%s:' "$?" "$value" "$REPLY" "\${#values[@]}"; printf '<%s>' "\${values[@]}"`;

function unchanged(status: number): string {
  return `status=${status};value=<OLD>;reply=<ROLD>;array=2:<old><keep>`;
}

interface Witness {
  readonly before?: string;
  readonly args: string;
  readonly input?: string | Uint8Array;
  readonly eof?: boolean;
}

interface NativeResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

function heldInputReference(witness: Witness): NativeResult {
  const input = Buffer.from(witness.input ?? "");
  assert.ok(input.length <= 16384);
  const script = `IFS= read -r -t1 -u3 __start || exit 97; ${initial} ${witness.before ?? ""} read ${witness.args}; ${snapshot}; printf '\\0'; IFS= read -r -t1 -u3 __continue || exit 98; IFS= read -r -t1 __tail; printf 'tail=%s:<%s>\\n' "$?" "$__tail"`;
  return primaryReference("timed-native.test.ts", script, undefined, [
    { fd: 0, method: witness.eof ? "end" : "write", hex: input.toString("hex") },
    { fd: 3, method: "write", hex: Buffer.from("start\n").toString("hex") },
    ...(witness.eof ? [] : [{ fd: 0, method: "end" as const, hex: Buffer.from("TAIL\n").toString("hex") }]),
    { fd: 3, method: "end", hex: Buffer.from("continue\n").toString("hex") },
  ]);
}

const grammar = [
  { name: "fraction rounds below one microsecond to readiness", args: "-t.0000004 -n0 value", output: unchanged(0) },
  { name: "fraction rounds up to a consuming zero-count operation", args: "-t.0000005 -n0 value", output: "status=0;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "minus sign alone means zero", args: "-t- value", output: unchanged(0) },
  { name: "signed dot alone means zero", args: "-t+. value", output: unchanged(0) },
  { name: "trailing bytes after six fractional digits are ignored", args: "-t1.0000000junk -n0 value", output: "status=0;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "trailing bytes before six fractional digits are rejected", args: "-t1.00000junk -n0 value", output: unchanged(1), diagnostic: "read: 1.00000junk: invalid timeout specification" },
  { name: "earlier invalid timeout is not repaired by later zero", args: "-t1e2 -t0 value", output: unchanged(1), diagnostic: "read: 1e2: invalid timeout specification" },
  { name: "later invalid timeout still rejects", args: "-t0 -t1e2 value", output: unchanged(1), diagnostic: "read: 1e2: invalid timeout specification" },
  { name: "last positive timeout takes precedence over earlier zero", args: "-t0 -t1 -n0 value", output: "status=0;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "last zero timeout takes precedence over earlier positive", args: "-t1 -t0 -n0 value", output: unchanged(0) },
  { name: "explicit invalid fd is checked after zero option", args: "-t0 -u9 value 9<&-", output: unchanged(1), diagnostic: "read: 9: invalid file descriptor: Bad file descriptor" },
  { name: "explicit invalid fd is checked before zero option", args: "-u9 -t0 value 9<&-", output: unchanged(1), diagnostic: "read: 9: invalid file descriptor: Bad file descriptor" },
  { name: "closed implicit stdin readiness fails without assignment or diagnostic", args: "-t0 value 0<&-", output: unchanged(1) },
  { name: "explicit closed stdin is diagnosed", args: "-t0 -u0 value 0<&-", output: unchanged(1), diagnostic: "read: 0: invalid file descriptor: Bad file descriptor" },
  { name: "closed zero-count input still assigns empty", args: "-n0 value 0<&-", output: "status=1;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "closed readiness overrides zero-count assignment", args: "-n0 -t0 value 0<&-", output: unchanged(1) },
] as const;

for (const entry of grammar) test(`Frozen primary Bash 5.3.0 timed read CLI: ${entry.name}`, () => {
  const actual = primaryReference("timed-native.test.ts", `${initial} read ${entry.args}; ${snapshot}; printf '\\n'; IFS= read -r -t1 __tail; printf 'tail=%s:<%s>\\n' "$?" "$__tail"`, "first second\nTAIL\n");
  assert.equal(actual.status, 0);
  assert.equal(actual.signal, null);
  assert.deepEqual(actual.stdout, Buffer.from(`${entry.output}\ntail=0:<first second>\n`));
  assert.deepEqual(actual.stderr, Buffer.from("diagnostic" in entry ? `shell: line 1: ${entry.diagnostic}\n` : ""));
});

const targets = [
  { name: "scalar", args: "value" },
  { name: "default REPLY", args: "" },
  { name: "indexed array", args: "-a values" },
  { name: "readonly scalar", before: "readonly value;", args: "value" },
  { name: "readonly array", before: "readonly values;", args: "-a values" },
  { name: "invalid scalar name", args: "bad-name" },
  { name: "invalid array name", args: "-a bad-name" },
] as const;

for (const target of targets) for (const state of ["ready", "blocked", "eof"] as const) {
  test(`Frozen primary Bash 5.3.0 -t0 ${state} leaves ${target.name} and input unchanged`, () => {
    const actual = heldInputReference({ args: `-t0 ${target.args}`, input: state === "ready" ? "first\n" : "", eof: state === "eof", ...("before" in target ? { before: target.before } : {}) });
    assert.equal(actual.status, 0);
    assert.deepEqual(actual.stdout, Buffer.from(`${unchanged(state === "blocked" ? 1 : 0)}\0${state === "eof" ? "tail=1:<>" : `tail=0:<${state === "ready" ? "first" : "TAIL"}>`}\n`));
    assert.deepEqual(actual.stderr, Buffer.alloc(0));
  });
}

const precedence = [
  { name: "zero readiness precedes -n0", args: "-t0 -n0 value", output: unchanged(1) },
  { name: "zero readiness precedes -N0", args: "-N0 -t0 -a values", output: unchanged(1) },
  { name: "positive timeout follows scalar zero-count assignment", args: "-t.02 -n0 value", output: "status=0;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "positive timeout follows array zero-count clearing", args: "-t.02 -N0 -a values", output: "status=0;value=<OLD>;reply=<ROLD>;array=0:<>" },
  { name: "TMOUT follows zero-count scalar assignment", before: "TMOUT=.02;", args: "-n0 value", output: "status=0;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "TMOUT follows zero-count array clearing", before: "TMOUT=.02;", args: "-N0 -a values", output: "status=0;value=<OLD>;reply=<ROLD>;array=0:<>" },
  { name: "explicit zero overrides positive TMOUT", before: "TMOUT=.02;", args: "-t0 value", output: unchanged(1) },
  { name: "last repeated zero overrides positive timeout", args: "-t.02 -t0 value", output: unchanged(1) },
  { name: "last repeated positive overrides zero timeout", args: "-t0 -t.02 value", output: "status=142;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "explicit positive overrides invalid TMOUT", before: "TMOUT=invalid;", args: "-t.02 value", output: "status=142;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "explicit positive overrides zero TMOUT", before: "TMOUT=0;", args: "-t.02 value", output: "status=142;value=<>;reply=<ROLD>;array=2:<old><keep>" },
] as const;

for (const entry of precedence) test(`Frozen primary Bash 5.3.0 timed read precedence: ${entry.name}`, () => {
  const actual = heldInputReference({ ...entry, input: "" });
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdout, Buffer.from(`${entry.output}\0tail=0:<TAIL>\n`));
  assert.deepEqual(actual.stderr, Buffer.alloc(0));
});

for (const value of ["invalid", "-1", "", "0"]) test(`Frozen primary Bash 5.3.0 invalid or disabled TMOUT ${JSON.stringify(value)} does not reject a complete record`, () => {
  const actual = primaryReference("timed-native.test.ts", `${initial} TMOUT='${value}'; read value; ${snapshot}`, "first\n");
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdout, Buffer.from("status=0;value=<first>;reply=<ROLD>;array=2:<old><keep>"));
  assert.deepEqual(actual.stderr, Buffer.alloc(0));
});

const partial = [
  { name: "partial scalar", args: "-t.02 value", input: "one two", output: "status=142;value=<one two>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "empty scalar", args: "-t.02 value", input: "", output: "status=142;value=<>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "partial array", args: "-t.02 -a values", input: "one two", output: "status=142;value=<OLD>;reply=<ROLD>;array=2:<one><two>" },
  { name: "empty array", args: "-t.02 -a values", input: "", output: "status=142;value=<OLD>;reply=<ROLD>;array=0:<>" },
  { name: "partial default REPLY keeps whitespace", args: "-rt.02", input: " one ", output: "status=142;value=<OLD>;reply=< one >;array=2:<old><keep>" },
  { name: "empty default REPLY", args: "-t.02", input: "", output: "status=142;value=<OLD>;reply=<>;array=2:<old><keep>" },
  { name: "TMOUT supplies partial scalar deadline", before: "TMOUT=.02;", args: "value", input: "one two", output: "status=142;value=<one two>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "TMOUT supplies empty array deadline", before: "TMOUT=.02;", args: "-a values", input: "", output: "status=142;value=<OLD>;reply=<ROLD>;array=0:<>" },
  { name: "partial count timeout", args: "-rt.02 -n5 value", input: "ab", output: "status=142;value=<ab>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "partial exact count timeout retains newline", args: "-rt.02 -N5 value", input: "ab\n", output: "status=142;value=<ab\n>;reply=<ROLD>;array=2:<old><keep>" },
  { name: "readonly scalar assignment overrides timeout status", before: "readonly value;", args: "-t.02 value", input: "one", output: unchanged(1), diagnostic: "value: readonly variable" },
  { name: "readonly array assignment overrides timeout status", before: "readonly values;", args: "-t.02 -a values", input: "one", output: unchanged(1), diagnostic: "values: readonly variable" },
  { name: "invalid array assignment overrides timeout status", args: "-t.02 -a bad-name", input: "one", output: unchanged(1), diagnostic: "read: `bad-name': not a valid identifier" },
] as const;

for (const entry of partial) test(`Frozen primary Bash 5.3.0 timed assignment: ${entry.name}`, () => {
  const actual = heldInputReference(entry);
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdout, Buffer.from(`${entry.output}\0tail=0:<TAIL>\n`));
  assert.deepEqual(actual.stderr, Buffer.from("diagnostic" in entry ? `shell: line 1: ${entry.diagnostic}\n` : ""));
});

test("Frozen primary Bash 5.3.0 timed partial raw array preserves invalid UTF-8 bytes", () => {
  const actual = heldInputReference({ args: "-rt.02 -a values", input: Uint8Array.of(255, 32, 254) });
  assert.equal(actual.status, 0);
  assert.deepEqual(actual.stdout, Buffer.concat([Buffer.from("status=142;value=<OLD>;reply=<ROLD>;array=2:<"), Buffer.from([255]), Buffer.from("><"), Buffer.from([254]), Buffer.from(">\0tail=0:<TAIL>\n")]));
  assert.deepEqual(actual.stderr, Buffer.alloc(0));
});
