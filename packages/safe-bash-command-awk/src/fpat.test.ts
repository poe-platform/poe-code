import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createAwkCommand, type AwkLimits } from "./index.js";

async function run(args: string[], input: string, limits: AwkLimits = {}, memory = false) {
  const fs = createMemoryFileSystem();
  if (memory) {
    await fs.writeFile("/input", new TextEncoder().encode(input));
    args = [...args, "/input"];
  }
  let stdout = "", stderr = "";
  const result = await createAwkCommand(limits).execute({
    command: "awk", args, argumentValues: createCommandArguments(args), cwd: "/", env: {}, fs,
    stdin: toByteSource(memory ? "" : input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
    ...(memory ? { _fastMemoryBackingFs: fs } : {}),
  });
  return { ...result, stdout, stderr };
}

for (const memory of [false, true]) {
  test(`FPAT retains quoted CSV fields through ${memory ? "memory file" : "stdin"} input`, async () => {
    const result = await run([
      String.raw`BEGIN { FPAT = "([^,]+)|(\"[^\"]+\")" } { print $2; print NF }`,
    ], 'a,"b,c",d\n', {}, memory);
    assert.deepEqual(result, { exitCode: 0, stdout: '"b,c"\n3\n', stderr: "" });
  });
}

for (const [program, input, expected] of [
  ['BEGIN { FS=","; FPAT=FPAT } { print NF,$2 }', "a b,c\n", "2 b,c\n"],
  ['BEGIN { FPAT="[0-9]+" } { print NF,$1,$2,$3 }', "a12b034c5\n", "3 12 034 5\n"],
  ['BEGIN { FPAT="[^,]+" } { FS=FS; print NF,$2; $0=$0; print NF,$2 }', "a,b\nc,d\n", "2 b\n1 \n1 \n1 \n"],
  ['BEGIN { FPAT="[^,]+"; FS=FS; FPAT=FPAT } { print NF,$2 }', "a,b\n", "2 b\n"],
  ['{ FPAT="[^,]+"; print NF; $0=$0; print NF,$2 }', "a,b\n", "1\n2 b\n"],
  ['BEGIN { FPAT="[^,]+" } { FPAT="[0-9]+"; print NF,$2; $0="a12b34"; print NF,$2 }', "a,b\n", "2 b\n2 34\n"],
  ['BEGIN { FPAT="[^,]+"; OFS="|" } { $2="changed"; print $0,NF; NF=1; print $0,NF }', "a,b,c\n", "a|changed|c|3\na|1\n"],
  ['BEGIN { FS=":"; FPAT="[^,]+" } { print split("a:b",a),a[2],NF }', "a,b,c\n", "2 b 3\n"],
  ['BEGIN { FPAT="[^,]+"; RS="" } { print NF; print $2 }', "a,b\nc,d\n", "3\nb\nc\n"],
  ['BEGIN { FPAT="[0-9]+" } { print NF }', "letters\n\n", "0\n0\n"],
  ['BEGIN { FPAT="[^,]*" } { print NF; for(i=1;i<=NF;i++) print "["$i"]" }', "a,,b,\n", "4\n[a]\n[]\n[b]\n[]\n"],
  ['BEGIN { FPAT="" } { print NF }', "abc\n\n", "4\n0\n"],
  ['BEGIN { FPAT="x*" } { print NF }', "é😀\n", "3\n"],
  ['BEGIN { FPAT="." } { print NF,$1,$2 }', "é😀\n", "2 é 😀\n"],
  ['BEGIN { FPAT="x"; FS=","; FPAT++ } { print NF,$1,$2 }', "a1b1c\n", "2 1 1\n"],
  ['BEGIN { FPAT="x"; FS=","; FPAT+=2 } { print NF,$1,$2 }', "a2b2c\n", "2 2 2\n"],
  ['BEGIN { FPAT="[^,]+"; FS=0; FS++ } { print NF,$2 }', "a1b\n", "2 b\n"],
  ['BEGIN { FPAT="[^,]+"; getline; print NF,$2 }', "a,b\n", "2 b\n"],
] as const) {
  test(`FPAT field semantics: ${program}`, async () => {
    const result = await run([program], input);
    assert.deepEqual(result, { exitCode: 0, stdout: expected, stderr: "" });
  });
}

for (const args of [
  ["-v", "FPAT=[^,]+", "{ print NF,$2 }"],
  ["{ print NF,$2 }", "FPAT=[^,]+"],
]) {
  test(`FPAT command-line assignment: ${args.join(" ")}`, async () => {
    assert.deepEqual(await run(args, "a,b,c\n"), { exitCode: 0, stdout: "3 b\n", stderr: "" });
  });
}

for (const pattern of ["[^,]+", "[^,]*"]) {
  test(`FPAT enforces field limits for ${pattern}`, async () => {
    const result = await run([`BEGIN { FPAT="${pattern}" } { print NF }`], "a,,b,c\n", { maxFields: 2 });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /field count limit exceeded/);
  });
}
