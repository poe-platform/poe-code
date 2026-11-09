import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource, type ShellValue } from "safe-bash-contracts";
import { createJoinCommand } from "./index.js";

test("join help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createJoinCommand().execute({
  command: "join", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

async function run(args: ShellValue[], files: Record<string, string | Uint8Array>) {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, typeof content === "string" ? new TextEncoder().encode(content) : content);
 const values = createCommandArguments(args);
 let stdout = "", stderr = "", combined = "";
 const stdoutBytes: number[] = [];
 const result = await createJoinCommand().execute({
  command: "join", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdoutBytes.push(...bytes); const text = new TextDecoder().decode(bytes); stdout += text; combined += text; } },
  stderr: { async write(bytes) { const text = new TextDecoder().decode(bytes); stderr += text; combined += text; } },
 });
 return { ...result, stdout, stdoutBytes, stderr, combined };
}

for (const args of [
 ["-o", "0", "1.2", "2.2", "left", "right"],
 ["-o0", "1.2,2.2", "left", "right"],
 ["-o", "0", "1.2", "-o", "2.2", "left", "right"],
 ["-o", "0", "1.2", "2.2", "--", "left", "right"],
 ["left", "-o", "0", "1.2", "2.2", "right"],
]) {
 test(`join accepts output lists across arguments: ${args.join(" ")}`, async () => {
  const result = await run(args, { "/left": "k A\n", "/right": "k B\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, args.lastIndexOf("-o") !== args.indexOf("-o") ? "k B A\n" : "k A B\n");
 });
}

for (const args of [
 ["-o", "0", "1.2", "2.2"],
 ["-o", "0", "--", "1.2", "2.2"],
 ["-o", "0", "1.2", "--", "1.2", "2.2"],
]) {
 test(`join preserves field-like filenames: ${args.join(" ")}`, async () => {
  const result = await run(args, { "/1.2": "k A\n", "/2.2": "k B\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, args.length === 6 ? "k A\n" : "k\n");
 });
}

for (const args of [
 ["-o", "0", "-i", "1.2", "left", "right"],
 ["-o", "auto", "1.2", "left", "right"],
 ["-o", "0", "--", "1.2", "left", "right"],
 ["-o", "0", "invalid", "left", "right"],
]) {
 test(`join rejects invalid extra operands: ${args.join(" ")}`, async () => {
  const result = await run(args, { "/left": "k A\n", "/right": "k B\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
 });
}

for (const format of ["", ",", ",0", " 0", "0,,1.2", "0  1.2", "0\t\t1.2", "0, 1.2", "0,,", "0  "]) {
 test(`join rejects empty output fields: ${JSON.stringify(format)}`, async () => {
  const result = await run(["-o", format, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("invalid output field"));
 });
}

for (const format of ["0,1.2", "0 1.2", "0\t1.2", "0,1.2,", "0 1.2 ", "0\t1.2\t", "0,"]) {
 test(`join accepts single output separators including the final separator: ${JSON.stringify(format)}`, async () => {
  const result = await run(["-o", format, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, format === "0," ? "k\n" : "k A\n");
  assert.equal(result.stderr, "");
 });
}

for (const prefix of ["", "-t", "-it"]) {
 for (const delimiter of [0x09, 0x3a, 0x80, 0xfe, 0xff]) {
  test(`join accepts raw delimiter ${delimiter} with prefix ${JSON.stringify(prefix)}`, async () => {
   const value = shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode(prefix), delimiter]));
   const option = prefix ? [value] : ["-t", value];
   const result = await run([...option, ...option, "/a", "/b"], {
    "/a": Uint8Array.of(107, delimiter, 65, 10),
    "/b": Uint8Array.of(107, delimiter, 66, 10),
   });
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.deepEqual(result.stdoutBytes, [107, delimiter, 65, delimiter, 66, 10]);
  });
 }
 for (const delimiter of [Uint8Array.of(0xff, 0xfe), new TextEncoder().encode("é"), new TextEncoder().encode("�")]) {
  test(`join rejects multi-byte delimiter ${[...delimiter]} with prefix ${JSON.stringify(prefix)}`, async () => {
   const value = shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode(prefix), ...delimiter]));
   const result = await run([...(prefix ? [value] : ["-t", value]), "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
   assert.equal(result.exitCode, 1);
   assert.ok(result.stderr.includes("join delimiter must be one byte in the C locale"), result.stderr);
   assert.deepEqual(result.stdoutBytes, []);
  });
 }
}

test("join rejects distinct delimiter bytes that decode identically", async () => {
 const result = await run(["-t", shellValueFromBytes(Uint8Array.of(0xfe)), "-t", shellValueFromBytes(Uint8Array.of(0xff)), "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
 assert.equal(result.exitCode, 1);
 assert.ok(result.stderr.includes("incompatible field delimiters"), result.stderr);
 assert.deepEqual(result.stdoutBytes, []);
});

// Verified against GNU coreutils 9.4 with LC_ALL=C.
for (const [option, minimum, left, right, expected, exitCode] of [
 ["--header", 5, "k A\nk B\nq C\n", "k X\nk Y\np Z\n", "k A X\nk B Y\n", 0],
 ["--ignore-case", 3, "A left\n", "a right\n", "A left right\n", 0],
 ["--check-order", 3, "b\na\n", "b\na\n", "", 1],
 ["--nocheck-order", 3, "b\na\n", "b\na\n", "b\na\n", 0],
 ["--zero-terminated", 3, "a left\0", "a right\0", "a left right\0", 0],
] as const) {
 test(`join accepts every unique prefix of ${option}`, async () => {
  for (let length = minimum; length <= option.length; length++) {
   const prefix = option.slice(0, length);
   const result = await run([prefix, "/a", "/b"], { "/a": left, "/b": right });
   assert.equal(result.exitCode, exitCode, `${prefix}: ${result.stderr}`);
   assert.equal(result.stdout, expected, prefix);
   if (exitCode === 0) assert.equal(result.stderr, "", prefix);
   else assert.ok(result.stderr.includes("not in sorted order"), result.stderr);
  }
 });
}

for (const option of ["--h", "--he", "--nochi", "--headers", "--Header", "--hea=1", "--ignore=", "--check=yes", "--nocheck=no", "--zero=0"]) {
 test(`join rejects invalid or ambiguous option ${option}`, async () => {
  const result = await run([option, "/a", "/b"], { "/a": "a\n", "/b": "a\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(`unsupported option ${option}`), result.stderr);
 });
}

test("join preserves abbreviated option names as operands after --", async () => {
 const result = await run(["--", "--hea", "--ignore"], { "/--hea": "a left\n", "/--ignore": "a right\n" });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout, "a left right\n");
});

// Verified against GNU coreutils 9.12 with LC_ALL=C.
for (const reverse of [false, true]) {
 for (const [left, right, stdout] of [
  ["b\na\nc\n", "b\nc\n", "b\nc\n"],
  ["b 1\na 2\nc 3\n", "c 3\n", "c 3 3\n"],
  ["b 1\nc 2\na 3\ne 4\n", "b 1\nc 2\nd 3\ne 4\n", "b 1 1\nc 2 2\ne 4 4\n"],
 ]) {
  test(`join ignores disorder read before checking starts: reverse=${reverse}, left=${JSON.stringify(left)}`, async () => {
   const files = { "/a": left!, "/b": right! };
   const args = reverse ? ["/b", "/a"] : ["/a", "/b"];
   for (const flags of [[], ["--nocheck-order"]]) {
    const result = await run([...flags, ...args], files);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
   }
   const strict = await run(["--check-order", ...args], files);
   assert.equal(strict.exitCode, 1);
   assert.ok(strict.stderr.includes(`file ${reverse ? 2 : 1} is not in sorted order`));
  });
 }
}

test("fully paired disorder remains allowed by default", async () => {
 const files = { "/a": "c\na\nb\n", "/b": "c\na\nb\n" };
 assert.equal((await run(["/a", "/b"], files)).exitCode, 0);
 assert.equal((await run(["--check-order", "/a", "/b"], files)).exitCode, 1);
});

for (const reverse of [false, true]) {
 for (const prefix of ["", "0\n"]) {
  for (const emitUnpaired of [false, true]) {
   for (const mode of ["default", "--check-order", "--nocheck-order"]) {
    test(`join drains disorder after EOF: reverse=${reverse}, prefix=${JSON.stringify(prefix)}, unpaired=${emitUnpaired}, mode=${mode}`, async () => {
     const files = { "/a": prefix, "/b": prefix + "b\na\n" };
     const file = reverse ? 1 : 2;
     const args = reverse ? ["/b", "/a"] : ["/a", "/b"];
     if (emitUnpaired) args.unshift(`-a${file}`);
     if (mode !== "default") args.unshift(mode);
     const result = await run(args, files);
     if (mode === "--check-order") {
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(`file ${file} is not in sorted order`));
     } else {
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, prefix + (emitUnpaired ? "b\na\n" : ""));
     }
    });
   }
  }
 }

 test(`join retains default checking after a mismatch: reverse=${reverse}`, async () => {
  const files = { "/a": "x\n", "/b": "a\nb\nd\nc\n" };
  const result = await run(reverse ? ["/b", "/a"] : ["/a", "/b"], files);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("not in sorted order"));
 });

 test(`join retains activated checking while draining: reverse=${reverse}`, async () => {
  const files = { "/a": "a\nb\n", "/b": "b\nd\nc\n" };
  const result = await run(reverse ? ["/b", "/a"] : ["/a", "/b"], files);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("not in sorted order"));
 });
}
