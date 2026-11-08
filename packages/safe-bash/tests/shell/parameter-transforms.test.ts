import assert from "node:assert/strict";
import test from "node:test";
import { getCommandArguments, writeText } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";
import { transformParameter } from "../../src/shell/parameter-transforms.js";
import { shellValueBytes, type ValueAllocation } from "../../src/contracts/value.js";
import { trimParameter } from "../../src/shell/parameter-trim.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases: readonly [string, string[]][] = [
  [String.raw`export value='$(echo injected) $HOME ` + "`echo injected`" + String.raw` "quoted" \ slash'; dump="${"$"}{value@A}"; unset value; eval "$dump"; args "$value"`, ['$(echo injected) $HOME `echo injected` "quoted" \\ slash']],
  [String.raw`export value=$'line1\nline2\t\r'; dump="${"$"}{value@A}"; unset value; eval "$dump"; args "$value"`, ["line1\nline2\t\r"]],
  [String.raw`arr=([2]='$(echo injected) $HOME' [5]=$'line1\nline2\t\r' [8]=''); dump="${"$"}{arr[@]@A}"; unset arr; eval "$dump"; args "${"$"}{arr[2]}" "${"$"}{arr[5]}" "${"$"}{arr[8]}"`, ['$(echo injected) $HOME', "line1\nline2\t\r", ""]],
  [String.raw`declare -A arr; key=$'$(echo injected)\nkey'; arr[$key]=$'value\t$(echo injected)'; dump="${"$"}{arr[@]@A}"; unset arr; eval "$dump"; args "${"$"}{arr[$key]}"`, ["value\t$(echo injected)"]],
  [String.raw`arr=('$(echo injected) $HOME' $'line1\nline2'); dump="${"$"}{arr[@]@K}"; eval "args $dump"`, ["0", '$(echo injected) $HOME', "1", "line1\nline2"]],
  [String.raw`value='$(echo injected)'; dump="${"$"}{value[@]@K}"; eval "args $dump"`, ['$(echo injected)']],
  [String.raw`declare -A arr; key=$'$(echo injected)\nkey'; arr[$key]=$'value\t$(echo injected)'; dump="${"$"}{arr[@]@K}"; eval "args $dump"`, ["$(echo injected)\nkey", "value\t$(echo injected)"]],
  [String.raw`SECRET=leaked; value='\$SECRET'; args "` + '${value@P}"', ["$SECRET"]],
  [String.raw`value='\$(echo PWNED)'; args "` + '${value@P}"', ["$(echo PWNED)"]],
  [String.raw`value='\$((1 + 2))'; args "` + '${value@P}"', ["$((1 + 2))"]],
  [String.raw`value='\\n|\\t|\\r|\\a|\\e|\\E'; args "` + '${value@P}"', [String.raw`\n|\t|\r|\a|\e|\E`]],
  [String.raw`SECRET=leaked; value='\\$SECRET'; args "` + '${value@P}"', ["$SECRET"]],
  [String.raw`value='a\nb\rc\ad\ee\E'; args "` + '${value@P}"', ["a\nb\rc\x07d\x1be\x1b"]],
  [String.raw`SECRET=expanded; value='$SECRET:$(say command):$((1 + 2))'; args "` + '${value@P}"', ["expanded:command:3"]],
  ['declare -A map; map[foo]=hELLo; args "${map[foo]^}" "${map[foo]^^}" "${map[foo],}" "${map[foo],,}" "${map[foo]@Q}"', ["HELLo", "HELLO", "hELLo", "hello", "'hELLo'"]],
  ["declare -A map; map[1]='a\\nb'; args \"${map[1]^^}\" \"${map[1]@Q}\" \"${map[1]@E}\"", [String.raw`A\NB`, String.raw`'a\nb'`, "a\nb"]],
  ['declare -A map; map[first]=hello; args "${map[0]@Q}" "${map[0]@E}" "${map[0]^^}"', ["", "", ""]],
  ['declare -A map; map[first]=hello; args ${map[0]@Q} "${map[first]@Q}"', ["'hello'"]],
  ['a=([3]=present [4]=""); args "${a[0]@Q}" "${a[4]@Q}" "${a[3]@Q}" "${missing[0]@Q}"', ["", "''", "'present'", ""]],
  ['a=([3]=present [4]=""); args ${a[0]@Q} ${a[4]@Q} ${a[3]@Q} ${missing[0]@Q}', ["''", "'present'"]],
  ['value=hello; args "${value[0]@Q}" "${value[1]@Q}"', ["'hello'", ""]],
  ['declare -A map; map[empty]=; args "${map[empty]@Q}" "${map[empty]@E}" "${map[empty],,}"', ["''", "", ""]],
  ['values=([1]=present); args "${values[0]@Q}" "${values[0]@E}" "${values[0]^^}"', ["", "", ""]],
  ['values=([0]=); args "${values[0]@Q}" "${values[0]@E}"', ["''", ""]],
  ['args "${missing[0]@Q}" "${missing[1]@Q}"', ["", ""]],
  ['declare -A map; map[0]=hello; key=0; args "${map[$key]@Q}" "${map[$key]^^}"', ["'hello'", "HELLO"]],
  ['value=ab; args "${value^^}" "${value^}"', ["AB", "Ab"]],
  ['value=AB; args "${value,,}" "${value,}"', ["ab", "aB"]],
  ['value=abca; args "${value^^[ac]}" "${value^b}" "${value,,}"', ["AbCA", "abca", "abca"]],
  ['value=abc; pattern="[ab]"; args "${value^^$pattern}" "${value^^"$pattern"}"', ["ABc", "abc"]],
  ['value=; args "${missing^^}" "${value,,}"', ["", ""]],
  ['value="éßİΣ"; args "${value^^}" "${value,,}"', ["ÉßİΣ", "éßiσ"]],
  ['set -- ab CD; args "${@^}" "${*,,}"', ["Ab", "CD", "ab cd"]],
  ['values=(ab cd); args "${values[@]^^}" "${values[*]^}" "${values[1]^^}"', ["AB", "CD", "Ab Cd", "CD"]],
  ['set --; args "${@^^}" "${*,,}"', [""]],
  ['value=abc; args "${value@Q}"', ["'abc'"]],
  ["value=\"a'b\"; args \"${value@Q}\"", ["'a'\\''b'"]],
  ['value=; args "${value@Q}" "${missing@Q}"', ["''", ""]],
  ["value=$'a\\nb\\t\\e'; args \"${value@Q}\"", [String.raw`$'a\nb\t\E'`]],
  ['value="a b"; args ${value@Q}', ["'a", "b'"]],
  ["value='a\\nb\\t'; args \"${value@E}\"", ["a\nb\t"]],
  ["value='a\\cB'; args \"${value@E}\"", ["a\x02"]],
  ["value='a\\0ignored'; args \"${value@E}\"", ["a"]],
  ["value='\\q\\x\\u'; args \"${value@E}\"", [String.raw`\q\x\u`]],
  ["value='\\101\\x42\\u03c0'; args \"${value@E}\"", ["ABπ"]],
  ['set -- abc "a b"; args "${@@Q}"', ["'abc'", "'a b'"]],
  ['set -- abc "a b"; IFS=:; args "${*@Q}"', ["'abc':'a b'"]],
  ['set --; args "${@@Q}" "${*@Q}"', [""]],
  ['values=(abc "a b"); args "${values[@]@Q}"', ["'abc'", "'a b'"]],
  ['values=(set ""); args "${values[4]@Q}" "${values[1]@Q}"', ["", "''"]],
  ['value=set; args "${value[1]@Q}" "${missing[0]@Q}" "${missing[2]@Q}"', ["", "", ""]],
  ["values=('a\\nb' '\\t'); args \"${values[@]@E}\"", ["a\nb", "\t"]],
  ['value=abc; args "${#value}" "${?@Q}" "${#@Q}"', ["3", "'0'", "'0'"]],
  ['set --; args "${@@Q}${*@E}"', []],
  ['set --; args "${@@E}${missing}"', []],
  ['set --; args "${@@Q}""${*@E}"', [""]],
  ['values=(); args "${values[@]@Q}${values[*]@E}"', []],
  ["values=('\\0'); args \"${values[@]@E}\"", [""]],
];

for (const operator of ["A", "K"]) test(`array @${operator} quotes printable shell metacharacters`, async () => {
  const payload = '$(echo injected) $HOME `echo injected` "double" \'single\' \\ backslash';
  const { shell } = setup({ env: { PAYLOAD: payload } });
  try {
    const source = operator === "A"
      ? 'declare -A arr; arr[$PAYLOAD]="$PAYLOAD"; dump="${arr[@]@A}"; unset arr; eval "$dump"; args "${arr[$PAYLOAD]}"'
      : 'declare -A arr; arr[$PAYLOAD]="$PAYLOAD"; dump="${arr[@]@K}"; eval "args $dump"';
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), operator === "A" ? [payload] : [payload, payload]);
  } finally { await shell.dispose(); }
});
for (const [source, expected] of cases) test(`GNU Bash 5.2.37 parameter transforms: ${source}`, async () => {
  const { shell } = setup({ env: { LC_ALL: "C.UTF-8" } });
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  } finally { await shell.dispose(); }
});

for (const [source, expected] of [
  ["value=$'a\\377B'; rawargs \"${value^^}\" \"${value,,}\"", ["41ff42", "61ff62"]],
  ["export value=$'a\\377B'; dump=\"${value@A}\"; unset value; eval \"$dump\"; rawargs \"$value\"", ["61ff42"]],
  ["arr=($'a\\377B'); dump=\"${arr[@]@A}\"; unset arr; eval \"$dump\"; rawargs \"${arr[0]}\"", ["61ff42"]],
  ["arr=($'a\\377B'); dump=\"${arr[@]@K}\"; eval \"rawargs $dump\"", ["30", "61ff42"]],
  ["value=$'\\377\\001\\n'; rawargs \"${value@Q}\"", [Buffer.from(String.raw`$'\377\001\n'`).toString("hex")]],
  ["value='\\377z'; rawargs \"${value@E}\"", ["ff7a"]],
  ["value='\\U00110000'; rawargs \"${value@E}\"", ["f4908080"]],
  ["values=('\\377' '\\101'); rawargs \"${values[@]@E}\"", ["ff", "41"]],
  ["declare -A map; map[foo]=$'a\\377B'; rawargs \"${map[foo]^^}\" \"${map[foo],,}\" \"${map[foo]@Q}\"", ["41ff42", "61ff62", Buffer.from(String.raw`$'a\377B'`).toString("hex")]],
] as const) test(`parameter transforms preserve exact bytes: ${source}`, async () => {
  const { shell } = setup({ env: { LC_ALL: "C.UTF-8" } });
  shell.register({ name: "rawargs", async execute(context) {
    const args = getCommandArguments(context);
    await writeText(context.stdout, JSON.stringify(args.values.map((_, index) => Buffer.from(args.bytes(index)!).toString("hex"))));
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), expected);
  } finally { await shell.dispose(); }
});

test("prompt transforms never execute escaped command substitutions", async () => {
  const { shell } = setup();
  let calls = 0;
  shell.register({ name: "probe", execute() { calls++; return { exitCode: 0 }; } });
  try {
    const result = await shell.exec(String.raw`value='\$(probe)'; args "` + '${value@P}"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), ["$(probe)"]);
    assert.equal(calls, 0);
  } finally { await shell.dispose(); }
});

test("associative transforms expand their key exactly once", async () => {
  const { shell } = setup();
  let calls = 0;
  shell.register({ name: "key", async execute({ stdout }) {
    calls++;
    await writeText(stdout, "foo");
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec('declare -A map; map[foo]=hello; args "${map[$(key)]@Q}" "${map[$(key)]^^}"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), ["'hello'", "HELLO"]);
    assert.equal(calls, 2);
  } finally { await shell.dispose(); }
});

for (const operator of ["@Q", "@E", "^", "^^", ",", ",,"]) test(`associative ${operator} preserves nounset failures`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`declare -A map; map[first]=hello; set -u; args "\${map[0]${operator}}"`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /unbound variable/u);
  } finally { await shell.dispose(); }
});

test("C locale case modification changes only ASCII bytes", async () => {
  const { shell } = setup({ env: { LC_ALL: "C" } });
  try {
    const result = await shell.exec('value="éaÉB"; args "${value^^}" "${value,,}"');
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), ["éAÉB", "éaÉb"]);
  } finally { await shell.dispose(); }
});

test("case modification preserves nounset failures", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('set -u; args "${missing^^}"');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /unbound variable/u);
  } finally { await shell.dispose(); }
});

test("default Shell supports the reported case expansions in virtual scripts", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(basicCommands()), env: { LC_ALL: "C" } });
  try {
    const source = 'x=ab; printf "%s\\n" "${x^^}"; x=AB; printf "%s\\n" "${x,,}"';
    const inline = await shell.exec(source);
    assert.equal(inline.exitCode, 0);
    assert.equal(inline.stderr, "");
    assert.equal(inline.stdout, "AB\nab\n");
    await fs.writeFile("/case.sh", Buffer.from(source));
    const script = await shell.exec("bash /case.sh");
    assert.equal(script.exitCode, 0);
    assert.equal(script.stderr, "");
    assert.equal(script.stdout, inline.stdout);
  } finally { await shell.dispose(); }
});

test("case modification admits growing UTF-8 output before allocating it", async () => {
  const reservations: number[] = [];
  const allocation: ValueAllocation = { assertOpen() {}, reserve(bytes) { reservations.push(bytes); return { commit() {}, release() {} }; } };
  const reason = new Error("output byte limit");
  await assert.rejects(trimParameter("ȿ", [], "^^", false, {
    remaining: 10_000, signal: new AbortController().signal, exhausted() { throw reason; }, allocation,
  }, allocation, 2), error => error === reason);
  assert.ok(!reservations.includes(67), "the three-byte result buffer must not be reserved");
});

test("case modification cooperates with live cancellation", async () => {
  const controller = new AbortController();
  const reason = { cancelled: "case modification" };
  const pending = trimParameter("a".repeat(100_000), [], "^^", true, {
    remaining: 10_000_000, signal: controller.signal, exhausted() { assert.fail("unexpected limit"); },
  });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(pending, error => error === reason); }
  finally { clearTimeout(timer); }
});

for (const operator of ["Z", "Q:-x"]) test(`unimplemented parameter transform remains refused: @${operator}`, async () => {
  const { shell } = setup();
  try { assert.equal((await shell.exec(`value=x; args "\${value@${operator}}"`)).exitCode, 2); }
  finally { await shell.dispose(); }
});

for (const redirect of ['<<< "${value@E}"', '<<EOF\n${value@E}\nEOF']) test(`raw transform bytes survive inline input: ${redirect}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`value='\\377'; pass ${redirect}`);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 10));
  } finally { await shell.dispose(); }
});

for (const raw of [false, true]) test(`large inline tail uses linear retained storage after ${raw ? "raw" : "plain"} prefix`, async () => {
  const { shell } = setup();
  const tail = "a".repeat(200_000);
  try {
    const result = await shell.exec(`value='\\377'; pass <<EOF\n${raw ? "${value@E}" : "x"}${tail}\nEOF`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    const expected = Buffer.concat([Uint8Array.of(raw ? 255 : 120), Buffer.from(tail), Uint8Array.of(10)]);
    assert.deepEqual(result.stdoutBytes, new Uint8Array(expected));
  } finally { await shell.dispose(); }
});

test("quoting refuses oversized output before reserving or materializing its buffer", async () => {
  const reservations: number[] = [];
  const allocation: ValueAllocation = { assertOpen() {}, reserve(bytes) { reservations.push(bytes); return { commit() {}, release() {} }; } };
  const reason = new Error("output byte limit");
  await assert.rejects(transformParameter("\n".repeat(16), "Q", {
    maximumBytes: 20, byteLocale: false, allocation,
    work: { remaining: 10_000, signal: new AbortController().signal, exhausted() { throw reason; } },
  }), error => error === reason);
  assert.deepEqual(reservations, [80], "only the admitted 16-byte input copy may exist");
});

test("escape decoding allocates exactly its measured output before publishing owned bytes", async () => {
  const reservations: number[] = [];
  const allocation: ValueAllocation = { assertOpen() {}, reserve(bytes) { reservations.push(bytes); return { commit() {}, release() {} }; } };
  const value = await transformParameter("\\377z", "E", {
    maximumBytes: 20, byteLocale: false, allocation,
    work: { remaining: 10_000, signal: new AbortController().signal, exhausted() { assert.fail("unexpected limit"); } },
  });
  assert.deepEqual(reservations, [69, 66, 70]);
  assert.deepEqual(shellValueBytes(value), Uint8Array.of(255, 122));
});

for (const operator of ["Q", "E"] as const) for (const reason of [false, { cancelled: operator }]) test(`${operator} cooperates with live ${typeof reason} cancellation`, async () => {
  const allocation: ValueAllocation = { assertOpen() {}, reserve() { return { commit() {}, release() {} }; } };
  const controller = new AbortController();
  const pending = transformParameter("x".repeat(100_000), operator, {
    maximumBytes: 1_000_000, byteLocale: false, allocation,
    work: { remaining: 10_000_000, signal: controller.signal, exhausted() { assert.fail("unexpected limit"); } },
  });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(pending, error => error === reason); }
  finally { clearTimeout(timer); }
});
