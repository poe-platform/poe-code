import assert from "node:assert/strict";
import test from "node:test";
import { getCommandArguments, writeText } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";
import { transformParameter } from "../../src/shell/parameter-transforms.js";
import { shellValueBytes, type ValueAllocation } from "../../src/contracts/value.js";

const cases: readonly [string, string[]][] = [
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
  ["values=('a\\nb' '\\t'); args \"${values[@]@E}\"", ["a\nb", "\t"]],
  ['value=abc; args "${#value}" "${?@Q}" "${#@Q}"', ["3", "'0'", "'0'"]],
  ['set --; args "${@@Q}${*@E}"', []],
  ['set --; args "${@@E}${missing}"', []],
  ['set --; args "${@@Q}""${*@E}"', [""]],
  ['values=(); args "${values[@]@Q}${values[*]@E}"', []],
  ["values=('\\0'); args \"${values[@]@E}\"", [""]],
];
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
  ["value=$'\\377\\001\\n'; rawargs \"${value@Q}\"", [Buffer.from(String.raw`$'\377\001\n'`).toString("hex")]],
  ["value='\\377z'; rawargs \"${value@E}\"", ["ff7a"]],
  ["value='\\U00110000'; rawargs \"${value@E}\"", ["f4908080"]],
  ["values=('\\377' '\\101'); rawargs \"${values[@]@E}\"", ["ff", "41"]],
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

for (const operator of ["P", "A", "a", "Q:-x"]) test(`unimplemented parameter transform remains refused: @${operator}`, async () => {
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
