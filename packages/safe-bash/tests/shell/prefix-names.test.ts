import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { ShellLimitError } from "../../src/shell/index.js";

const cases: readonly [string, string[][]][] = [
  ['ZZb=2; ZZa=1; args "${!ZZ@}"; args "${!ZZ*}"', [["ZZa", "ZZb"], ["ZZa ZZb"]]],
  ['ZZb=2; ZZa=1; IFS=:; args "${!ZZ@}"; args "${!ZZ*}"; args ${!ZZ@}; args ${!ZZ*}', [["ZZa", "ZZb"], ["ZZa:ZZb"], ["ZZa", "ZZb"], ["ZZa", "ZZb"]]],
  ['ZZb=2; ZZa=1; IFS=; args ${!ZZ@}; args ${!ZZ*}; args "${!ZZ*}"', [["ZZa", "ZZb"], ["ZZaZZb"], ["ZZaZZb"]]],
  ['ZZA=1; ZZB=2; IFS=A; args ${!ZZ@}; args ${!ZZ*}; args "${!ZZ@}"', [["ZZ", "", "ZZB"], ["ZZ", "", "ZZB"], ["ZZA", "ZZB"]]],
  ['args "${!ZZ@}"; args "${!ZZ*}"; args "x${!ZZ@}y"; args "${!ZZ@}${!ZZ@}"', [[], [""], ["xy"], []]],
  ['ZZb=2; ZZa=1; args "x${!ZZ@}y"; value=${!ZZ@}; args "$value"', [["xZZa", "ZZby"], ["ZZa ZZb"]]],
  ['ZZb=2; ZZa=; export ZZunset; unset ZZb; args "${!ZZ@}"', [["ZZa"]]],
  ['ZZouter=x; f() { local ZZouter; local ZZbare; local ZZset=; args "${!ZZ@}"; unset ZZouter; args "${!ZZ@}"; }; f; args "${!ZZ@}"', [["ZZouter", "ZZset"], ["ZZouter", "ZZset"], ["ZZouter"]]],
  ['ZZarray=(); args "${!ZZ@}"; ZZarray[3]=x; unset "ZZarray[3]"; args "${!ZZ@}"; unset ZZarray; args "${!ZZ@}"', [["ZZarray"], ["ZZarray"], []]],
  ['f() { local -a ZZarray; args "${!ZZ@}"; ZZarray=(); args "${!ZZ@}"; unset "ZZarray[@]"; args "${!ZZ@}"; }; f; args "${!ZZ@}"', [[], ["ZZarray"], ["ZZarray"], []]],
  ['ZZarray=(); f() { local -a ZZarray; args "${!ZZ@}"; }; f; (args "${!ZZ@}"); args "${!ZZ@}"', [["ZZarray"], ["ZZarray"], ["ZZarray"]]],
  ['set -u; args "${!ZZ@}"; args "${!ZZ*}"', [[], [""]]],
  ['ZZb=2; ZZa=1; IFS=:; value=${!ZZ@}; args "$value"; value=${!ZZ*}; args "$value"', [["ZZa:ZZb"], ["ZZa:ZZb"]]],
  ['ZZb=2; ZZa=1; IFS=:; [[ ${!ZZ@} == "ZZa ZZb" ]]; args "$?"; [[ ${!ZZ*} == "ZZa:ZZb" ]]; args "$?"', [["0"], ["0"]]],
  ['ZZb=2; ZZa=1; args "${missing:-${!ZZ@}}"; args "${missing:-${!ZZ*}}"; args "${!ZZ@}-${!ZZ@}"', [["ZZa", "ZZb"], ["ZZa ZZb"], ["ZZa", "ZZb-ZZa", "ZZb"]]],
  ['f() { local -a ZZarray; ZZarray+=(); args "${!ZZ@}"; }; f; args "${!ZZ@}"', [["ZZarray"], []]],
  ['ZZarray=(); (unset ZZarray; args "${!ZZ@}"); args "${!ZZ@}"', [[], ["ZZarray"]]],
  ['args "${!ZZ@}${!ZZ*}"; args "${!ZZ*}${!ZZ@}"; empty=; args "${!ZZ@}$empty"; args "$empty${!ZZ@}"', [[], [], [], []]],
  ['args "${!ZZ@}""${!ZZ*}"; args "${!ZZ*}""${!ZZ@}"; args ""${!ZZ@}; args "${!ZZ@}"""; args "${missing:-${!ZZ@}}"', [[""], [""], [""], [""], [""]]],
  ['outer() { local -a ZZarray; inner() { local -a ZZarray; ZZarray=(); args "${!ZZ@}"; }; inner; args "${!ZZ@}"; }; outer', [["ZZarray"], []]],
  ['ZZarray+=(); args "${!ZZ@}"; args "${!missing@}${!missing*}"{,}', [["ZZarray"], []]],
];
for (const [script, expected] of cases) test(`GNU Bash 5.2.37 prefix-name expansion: ${script}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(script);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected.map(row => JSON.stringify(row)).join(""));
  } finally { await shell.dispose(); }
});

for (const source of ["${!value}", "${!*}", "${!@}", "${!ZZ@:-x}", "${!ZZ[0]}"]) test(`prefix listing does not enable separate indirect syntax: ${source}`, async () => {
  const { shell } = setup();
  try { assert.equal((await shell.exec(`args "${source}"`)).exitCode, 2); }
  finally { await shell.dispose(); }
});

for (const [suffix, expected] of [
  ['pass <<EOF\n${!ZZ@}\n${!ZZ*}\nEOF', "ZZa ZZb\nZZa ZZb\n"],
  ['pass <<< "${!ZZ@}"; pass <<< "${!ZZ*}"', "ZZa:ZZb\nZZa:ZZb\n"],
  ['pass <<EOF\n$(args "${!ZZ*}")\nEOF', '["ZZa:ZZb"]\n'],
] as const) test(`prefix names use the enclosing input context: ${suffix}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`ZZb=2; ZZa=1; IFS=:; ${suffix}`);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

for (const [limit, value] of [["maxExpansionFields", 8], ["maxExpansionBytes", 256]] as const) test(`prefix listing retains ${limit}`, async () => {
  const env = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`ZZname${index}`, ""]));
  const { shell } = setup({ env, limits: { [limit]: value } });
  try { await assert.rejects(shell.exec('args "${!ZZ@}"'), error => error instanceof ShellLimitError && error.limit === limit); }
  finally { await shell.dispose(); }
});

test("enumerating nonmatching names still consumes bounded work", async () => {
  const env = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`OTHERname${index}`, ""]));
  const { shell } = setup({ env, limits: { maxExpansionBytes: 512 } });
  try {
    assert.equal((await shell.exec("args plain")).stdout, '["plain"]');
    await assert.rejects(shell.exec('args "${!ZZ@}"'), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  } finally { await shell.dispose(); }
});

test("environment entries that are not shell identifiers are not variable names", async () => {
  const { shell } = setup({ env: { "ZZ-bad": "x", "ZZ space": "x", "ZZé": "x", ZZgood: "x" } });
  try {
    const result = await shell.exec('args "${!ZZ@}"');
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["ZZgood"]');
  } finally { await shell.dispose(); }
});

for (const reason of [false, { cancelled: "prefix scan" }]) test(`prefix listing preserves live ${typeof reason} cancellation and does not dispatch`, async () => {
  const controller = new AbortController();
  const env = Object.fromEntries(Array.from({ length: 4000 }, (_, index) => [`ZZname${index}`, ""]));
  const { shell } = setup({ env });
  let dispatched = 0;
  shell.register({ name: "effect", execute() { dispatched++; return { exitCode: 0 }; } });
  const pending = shell.exec('effect "${!ZZ@}"', { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(pending, error => error === reason);
    assert.equal(dispatched, 0);
    assert.equal((await shell.exec("status 0")).exitCode, 0);
  } finally { clearTimeout(timer); await shell.dispose(); }
});
