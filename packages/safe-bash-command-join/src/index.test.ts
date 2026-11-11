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

async function run(args: ShellValue[], files: Record<string, string | Uint8Array>, env: Record<string, string> = {}) {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, typeof content === "string" ? new TextEncoder().encode(content) : content);
 const values = createCommandArguments(args);
 let stdout = "", stderr = "", combined = "";
 const stdoutBytes: number[] = [];
 const result = await createJoinCommand().execute({
  command: "join", args: values.args, argumentValues: values, cwd: "/", env, fs,
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdoutBytes.push(...bytes); const text = new TextDecoder().decode(bytes); stdout += text; combined += text; } },
  stderr: { async write(bytes) { const text = new TextDecoder().decode(bytes); stderr += text; combined += text; } },
 });
 return { ...result, stdout, stdoutBytes, stderr, combined };
}

for (const { args, expected } of [
 { args: ["-o", "auto", "-o", "0"], expected: "a\na\na\na\n" },
 { args: ["-o", "0", "-o", "auto"], expected: "a\na\na\na\n" },
 { args: ["-o", "auto"], expected: "a L1 R1\na L1 R2\na L2 R1\na L2 R2\n" },
 { args: ["-o", "auto", "-o", "auto"], expected: "a L1 R1\na L1 R2\na L2 R1\na L2 R2\n" },
 { args: ["-oauto", "-o1.2", "-oauto", "-o2.2", "-oauto"], expected: "L1 R1\nL1 R2\nL2 R1\nL2 R2\n" },
]) {
 test(`join gives explicit output fields precedence over auto: ${args.join(" ")}`, async () => {
  const result = await run([...args, "left", "right"], {
   "/left": "a L1\na L2\nc L3\n",
   "/right": "a R1\na R2\nb R3\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
 });
}

for (const terminator of ["\n", "\0"]) {
 for (const delimiter of ["\n", "|"]) {
  for (const format of ["1.1,2.1", "0,0"]) {
   test(`join preserves the output delimiter: ${JSON.stringify({ terminator, delimiter, format })}`, async () => {
    const result = await run([
     ...(terminator === "\0" ? ["-z"] : []), "-t", delimiter, "-o", format, "/left", "/right",
    ], { "/left": `A${terminator}`, "/right": `A${terminator}` }, { LC_ALL: "C" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, [...Buffer.from(`A${delimiter}A${terminator}`)]);
    assert.equal(result.stderr, "");
   });
  }
 }
}

for (const args of [
 ["-z", "-t", "\n"],
 ["-t\n", "-z"],
 ["-zt\n"],
 ["-z", "-t", ""],
 ["-z", "-t", "\n", "-t", ""],
 ["-t", "", "-t", "\n", "-z"],
]) {
 for (const right of ["a\nred\0", "a\nblue\0"]) {
  test(`join whole-record delimiters: ${JSON.stringify(args)}, right=${JSON.stringify(right)}`, async () => {
   const result = await run([...args, "/left", "/right"], { "/left": "a\nred\0", "/right": right });
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.deepEqual(result.stdoutBytes, Array.from(new TextEncoder().encode(right === "a\nred\0" ? right : "")));
  });
 }
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

for (const [format, expected] of [["1.+2", "A\n"], ["2.+2", "B\n"], ["0,1.+2,2.2", "k A B\n"]]) {
 test(`join accepts positive output field numbers: ${format}`, async () => {
  const result = await run(["-o", format!, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(result.stderr, "");
 });
}

for (const file of [1, 2]) {
 for (const field of ["0", "+0", "-2", "++2", "+", "+2x"]) {
  test(`join rejects invalid output field numbers: ${file}.${field}`, async () => {
   const result = await run(["-o", `${file}.${field}`, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
   assert.equal(result.exitCode, 1);
   assert.equal(result.stdout, "");
   assert.ok(result.stderr.includes("invalid output field"), result.stderr);
  });
 }
}

for (const prefix of ["", "-e", "-ie"]) {
 for (const replacement of [Uint8Array.of(0xff), Uint8Array.of(0xfe, 0xff), new TextEncoder().encode("é"), new Uint8Array()]) {
  if (prefix && !replacement.length) continue;
  test(`join preserves replacement bytes ${[...replacement]} with prefix=${prefix}`, async () => {
   const option = prefix
    ? [shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode(prefix), ...replacement]))]
    : ["-e", shellValueFromBytes(replacement)];
   const result = await run([...option, ...option, "-o", "1.3", "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.deepEqual(result.stdoutBytes, [...replacement, 10]);
  });
 }
 for (const other of [Uint8Array.of(0xfe), new TextEncoder().encode("�"), new Uint8Array()]) {
  test(`join rejects byte-distinct replacements ${[...other]} with prefix=${prefix}`, async () => {
   const first = prefix
    ? [shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode(prefix), 0xff]))]
    : ["-e", shellValueFromBytes(Uint8Array.of(0xff))];
   const result = await run([...first, "-e", shellValueFromBytes(other), "-o", "1.3", "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
   assert.equal(result.exitCode, 1);
   assert.equal(result.stderr, "join: EINVAL: conflicting empty-field replacement strings\n");
   assert.deepEqual(result.stdoutBytes, []);
  });
 }
}

for (const separator of ["\n", "\0"]) {
 for (const tail of [" ", "\t", "  \t "]) {
  for (const args of [[], ["-e", "NA"], ["-o", "auto"], ["-e", "NA", "-o", "auto"]]) {
   test(`join ignores trailing blanks: separator=${JSON.stringify(separator)}, tail=${JSON.stringify(tail)}, args=${JSON.stringify(args)}`, async () => {
    const flags = separator === "\0" ? ["-z"] : [];
    const result = await run([...flags, ...args, "/a", "/b"], {
     "/a": `k A${tail}${separator}`, "/b": `k X${tail}${separator}`,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `k A X${separator}`);
    assert.equal(result.stderr, "");
   });
  }
 }
}

// GNU coreutils on 64-bit Linux saturates field numbers at PTRDIFF_MAX.
test("join validates every digit even after field-number saturation", async () => {
 for (const field of ["", "+", "0", "+0", "-1", "1.0", "1e0", "0x1", "1 ", "++1", "18446744073709551616x"]) {
  const result = await run(["-j", field, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `join: EINVAL: invalid field: ${field}\n`);
 }
});

for (const field of ["9007199254740991", "9007199254740992", "9007199254740993", "9223372036854775807", "18446744073709551616", "9".repeat(400), "+009007199254740992"]) {
 test(`join accepts large field number ${field}`, async () => {
  for (const [args, expected] of [
   [["-j", field], " k A k B\n"],
   [[`-j${field}`], " k A k B\n"],
   [["-j", ` \t${field}`], " k A k B\n"],
   [["-1", field, "-2", field], " k A k B\n"],
   [[`-1${field}`, `-2${field}`], " k A k B\n"],
   [["-o", `1.${field}`], "\n"],
   [["-e", "missing", "-o", `2.${field}`], "missing\n"],
  ] as const) {
   const result = await run([...args, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, expected);
   assert.equal(result.stderr, "");
  }
 });
}

for (const [first, second, compatible] of [
 ["9007199254740992", "9007199254740993", false],
 ["9007199254740992", "+009007199254740992", true],
 ["9223372036854775806", "9223372036854775807", false],
 ["9223372036854775807", "9223372036854775808", true],
 ["18446744073709551615", "18446744073709551616", true],
] as const) {
 test(`join compares repeated fields precisely: ${first}, ${second}`, async () => {
  for (const flag of ["-j", "-1", "-2"]) {
   const result = await run(["-j", first, flag, second, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
   assert.equal(result.exitCode, compatible ? 0 : 1, result.stderr);
   assert.equal(result.stdout, compatible ? " k A k B\n" : "");
   assert.equal(result.stderr, compatible ? "" : `join: EINVAL: incompatible join fields ${BigInt(first) - 1n}, ${BigInt(second) - 1n}\n`);
  }
 });
}

for (const flag of ["-a", "-v"]) {
 for (const [selector, unpaired] of [
  ["1", "z ZZ\n"], ["+1", "z ZZ\n"], ["01", "z ZZ\n"], ["+001", "z ZZ\n"],
  ["2", "y YY\n"], ["+2", "y YY\n"], ["02", "y YY\n"], ["+002", "y YY\n"],
 ] as const) {
  test(`join ${flag} accepts decimal file selector ${selector}`, async () => {
   for (const args of [[flag, selector], [flag + selector]]) {
    const result = await run([...args, "/left", "/right"], { "/left": "k AA\nz ZZ\n", "/right": "k BB\ny YY\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, (flag === "-a" ? "k AA BB\n" : "") + unpaired);
    assert.equal(result.stderr, "");
   }
  });
 }
 for (const selector of ["0", "3", "-1", "", "+", "1.0", "1e0", "0x1", "1 ", "1x", "++1", "9007199254740992", "18446744073709551616"]) {
  test(`join ${flag} rejects invalid file selector ${JSON.stringify(selector)}`, async () => {
   const result = await run([flag, selector, "/left", "/right"], { "/left": "k AA\n", "/right": "k BB\n" });
   assert.equal(result.exitCode, 1);
   assert.equal(result.stdout, "");
   assert.equal(result.stderr, `join: EINVAL: invalid file number: ${selector}\n`);
  });
 }
}

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
   else assert.equal(result.stderr, "join: /a:2: is not sorted: a\n");
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
   assert.ok(strict.stderr.startsWith("join: /a:"), strict.stderr);
   assert.ok(strict.stderr.includes(": is not sorted: "), strict.stderr);
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
      assert.equal(result.stderr, `join: /b:${prefix ? 3 : 2}: is not sorted: a\n`);
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

for (const whitespace of [" ", "\t", "\n", "\r", "\v", "\f", " \t"]) {
 for (const field of ["1", "+1", "01", "+2", "02"]) {
  for (const flag of ["-j", "-1", "-2", "-a", "-v"]) {
   test(`join accepts leading whitespace: ${flag} ${JSON.stringify(whitespace + field)}`, async () => {
    const second = Number(field) === 2;
    const left = flag === "-j" || flag === "-1" ? (second ? "A k\n" : "k A\n") : "k A\nx X\n";
    const right = flag === "-j" || flag === "-2" ? (second ? "B k\n" : "k B\n") : "k B\ny Y\n";
    const unpaired = second ? "y Y\n" : "x X\n";
    const expected = flag === "-v" ? unpaired : "k A B\n" + (flag === "-a" ? unpaired : "");
    for (const args of [[flag, whitespace + field], [flag + whitespace + field]]) {
     const result = await run([...args, "/a", "/b"], { "/a": left, "/b": right });
     assert.equal(result.exitCode, 0, result.stderr);
     assert.equal(result.stdout, expected);
     assert.equal(result.stderr, "");
    }
   });
  }
 }
}

for (const flag of ["-j", "-1", "-2", "-a", "-v"]) {
 for (const value of [" 0", " -1", " +", " ", " 1 ", " 1\t", " 1\n", " 1x", " 1.0", " 0x1", "\u00a01", "\ufeff1", ...(flag === "-a" || flag === "-v" ? [" 3", " 9007199254740992"] : [])]) {
  test(`join rejects invalid padded number: ${flag} ${JSON.stringify(value)}`, async () => {
   const result = await run([flag, value, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
   assert.equal(result.exitCode, 1);
   assert.equal(result.stdout, "");
  });
 }
}

for (const format of ["1. 2", "1.\t2", "1.\n2", "1.\v2", "1.\f2", "1.\r2"]) {
 test(`join output field grammar does not accept padding: ${JSON.stringify(format)}`, async () => {
  const result = await run(["-o", format, "/a", "/b"], { "/a": "k A\n", "/b": "k B\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
 });
}

// GNU coreutils 9.10 recognizes locale blanks in -o lists, including U+2003/U+3000.
for (const separator of [",", " ", "\t", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2008", "\u2009", "\u200a", "\u205f", "\u3000"]) {
 for (const locale of ["C.UTF-8", "C", "POSIX"]) {
  test(`join output list separator ${JSON.stringify(separator)} in ${locale}`, async () => {
   const result = await run(["-o", `0${separator}1.2${separator}2.2`, "/left", "/right"],
    { "/left": "a red\n", "/right": "a blue\n" }, { LC_ALL: locale });
   const accepted = locale === "C.UTF-8" || [",", " ", "\t"].includes(separator);
   assert.equal(result.exitCode, accepted ? 0 : 1, result.stderr);
   assert.equal(result.stdout, accepted ? "a red blue\n" : "");
   if (accepted) assert.equal(result.stderr, "");
   else assert.ok(result.stderr.includes("invalid output field"), result.stderr);
  });
 }
}

test("join output lists use LC_ALL, LC_CTYPE, then LANG for locale blanks", async () => {
 for (const [env, accepted] of [
  [{ LANG: "C.UTF-8" }, true],
  [{ LC_CTYPE: "C.utf8", LANG: "C" }, true],
  [{ LC_ALL: "C.UTF-8", LC_CTYPE: "C" }, true],
  [{ LC_ALL: "", LC_CTYPE: "C.UTF-8" }, true],
  [{ LC_ALL: "C", LC_CTYPE: "C.UTF-8" }, false],
  [{ LC_CTYPE: "POSIX", LANG: "C.UTF-8" }, false],
  [{}, false],
 ] as const) {
  const result = await run(["-o", "0\u20031.2\u30002.2", "/left", "/right"],
   { "/left": "a red\n", "/right": "a blue\n" }, env);
  assert.equal(result.exitCode, accepted ? 0 : 1, JSON.stringify(env) + result.stderr);
  assert.equal(result.stdout, accepted ? "a red blue\n" : "");
 }
});

test("join locale blanks preserve trailing separators and reject empty fields", async () => {
 for (const separator of ["\u2003", "\u3000"]) {
  for (const [format, accepted] of [
   [`0${separator}1.2${separator}2.2${separator}`, true],
   [`${separator}0`, false],
   [`0${separator}${separator}1.2`, false],
   [`0,${separator}1.2`, false],
   [`0${separator}${separator}`, false],
  ] as const) {
   const result = await run(["-o", format, "/left", "/right"],
    { "/left": "a red\n", "/right": "a blue\n" }, { LC_ALL: "C.UTF-8" });
   assert.equal(result.exitCode, accepted ? 0 : 1, JSON.stringify(format) + result.stderr);
   assert.equal(result.stdout, accepted ? "a red blue\n" : "");
   if (accepted) assert.equal(result.stderr, "");
   else assert.ok(result.stderr.includes("invalid output field"), result.stderr);
  }
 }
});

for (const separator of ["\n", "\r", "\v", "\f", "\u0085", "\u00a0", "\u2007", "\u2028", "\u2029", "\u202f", "\ufeff"]) {
 test(`join output lists reject non-blank whitespace ${JSON.stringify(separator)}`, async () => {
  const result = await run(["-o", `0${separator}1.2${separator}2.2`, "/left", "/right"],
   { "/left": "a red\n", "/right": "a blue\n" }, { LC_ALL: "C.UTF-8" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("invalid output field"), result.stderr);
 });
}
