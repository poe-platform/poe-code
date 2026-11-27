import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createAwkCommand, type AwkLimits } from "./index.js";

async function run(args: string[], input = "", limits: AwkLimits = {}, file = false, env = {}) {
  const fs = createMemoryFileSystem();
  if (file) await fs.writeFile("/input", new TextEncoder().encode(input));
  const values = createCommandArguments(file ? [...args, "/input"] : args);
  let stdout = "", stderr = "";
  const result = await createAwkCommand(limits).execute({
    command: "awk", args: values.args, argumentValues: values, cwd: "/", env, fs,
    stdin: toByteSource(file ? "" : input), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { ...result, stdout, stderr };
}

for (const file of [false, true]) {
  for (const [program, input, stdout] of [
    ['BEGIN { FIELDWIDTHS="2 3 1" } { print $1, $2, $3, NF }', "abcdefgh\n", "ab cde f 3\n"],
    ['BEGIN { FIELDWIDTHS="2 3 1" } { print NF, "["$1"]", "["$2"]", "["$3"]" }', "abc\nab\n\n", "2 [ab] [c] []\n1 [ab] [] []\n0 [] [] []\n"],
    ['BEGIN { FIELDWIDTHS="2 3" } { print "["$1"]", "["$2"]", $0 }', " a b c\n", "[ a] [ b ]  a b c\n"],
    ['BEGIN { FIELDWIDTHS="2 3" } { FIELDWIDTHS="1 1"; print $1, $2, NF }', "abcde\nabcde\n", "ab cde 2\na b 2\n"],
    ['BEGIN { FIELDWIDTHS="2 3" } { FS=FS; print $1, $2, NF }', "abcde\na b\n", "ab cde 2\na b 2\n"],
    ['BEGIN { FIELDWIDTHS="2 3" } { $0="12345"; print $1, $2, NF; $2="x"; print $0 }', "abcde\n", "12 345 2\n12 x\n"],
    ['BEGIN { FIELDWIDTHS="2 3"; print split("a b c", a), a[2] }', "", "3 b\n"],
    ['BEGIN { FIELDWIDTHS="" } { print NF, $0 }', "abc\n", "0 abc\n"],
    ['BEGIN { FIELDWIDTHS=1; FIELDWIDTHS++; FIELDWIDTHS+=1 } { print $1, NF }', "abcdef\n", "abc 1\n"],
    ['BEGIN { FIELDWIDTHS="1:2 1:2 *" } { print "["$1"]", "["$2"]", "["$3"]", NF }', "abcdefgh\na\n", "[bc] [ef] [gh] 3\n[] [] [] 1\n"],
    ['BEGIN { FIELDWIDTHS="2 1"; getline; print $1, $2, NF }', "abcd\n", "ab c 2\n"],
    ['BEGIN { RS=""; FIELDWIDTHS="3 2" } { print "["$1"]", "["$2"]", NF }', "ab\ncd\n\n", "[ab\n] [cd] 2\n"],
  ] as const) test(`FIELDWIDTHS ${file ? "file" : "stdin"}: ${program}`, async () => {
    assert.deepEqual(await run([program], input, {}, file), { exitCode: 0, stdout, stderr: "" });
  });
}

test("FIELDWIDTHS supports command-line assignments and long records", async () => {
  for (const args of [["-v", "FIELDWIDTHS=300 2", "{ print length($1), $2, NF }"], ["{ print length($1), $2, NF }", "FIELDWIDTHS=300 2"]]) {
    assert.deepEqual(await run(args, "a".repeat(300) + "bcde\n"), { exitCode: 0, stdout: "300 bc 2\n", stderr: "" });
  }
});

for (const widths of ["0", "-1", "2 nope", "1.5", "2:", "* 2"]) {
  test(`FIELDWIDTHS rejects invalid widths before reading input: ${widths}`, async () => {
    const result = await run(["-v", `FIELDWIDTHS=${widths}`, 'BEGIN { print "unreachable" }']);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /invalid FIELDWIDTHS/);
  });
}

test("FIELDWIDTHS respects the field limit", async () => {
  const result = await run(['BEGIN { FIELDWIDTHS="1 1 1" } { print NF }'], "abc\n", { maxFields: 2 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /field count limit exceeded/);
});

test("FIELDWIDTHS and FPAT select the most recently assigned splitting mode", async () => {
  const program = 'BEGIN { FIELDWIDTHS="2 3"; FPAT="[a-z]+"; $0="a-b"; print $1,$2,NF; FIELDWIDTHS=FIELDWIDTHS; $0="abcde"; print $1,$2,NF }';
  assert.deepEqual(await run([program]), { exitCode: 0, stdout: "a b 2\nab cde 2\n", stderr: "" });
});

test("FIELDWIDTHS releases parsed widths when replacing the splitting mode", async () => {
  const program = 'BEGIN { for(i=0;i<100;i++) { FIELDWIDTHS="1 1"; FS=" " } print "ok" }';
  assert.deepEqual(await run([program], "", { maxRetainedBytes: 1024 }), { exitCode: 0, stdout: "ok\n", stderr: "" });
});

test("FIELDWIDTHS bounds the retained width specification", async () => {
  const result = await run(["-v", "FIELDWIDTHS=" + "1 ".repeat(60), 'BEGIN { print "unreachable" }'], "", { maxRetainedBytes: 1024 });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /retained text limit exceeded/);
});
