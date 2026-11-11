import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource, type ShellValue } from "safe-bash-contracts";
import { createCommCommand } from "./index.js";

test("comm help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createCommCommand().execute({
  command: "comm", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

async function run(args: ShellValue[], files: Record<string, string>, env: Record<string, string> = {}, stdin = "") {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(content));
 const values = createCommandArguments(args);
 let stdout = "", stderr = "", combined = "";
 const stdoutBytes: number[] = [];
 const result = await createCommCommand().execute({
  command: "comm", args: values.args, argumentValues: values, cwd: "/", env, fs,
  stdin: toByteSource(stdin), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdoutBytes.push(...bytes); const text = new TextDecoder().decode(bytes); stdout += text; combined += text; } },
  stderr: { async write(bytes) { const text = new TextDecoder().decode(bytes); stderr += text; combined += text; } },
 });
 return { ...result, stdout, stdoutBytes, stderr, combined };
}

for (const option of ["--help", "--version"]) {
 for (const value of [undefined, "", "1"]) {
  test(`comm ${option} operand with POSIXLY_CORRECT=${JSON.stringify(value)}`, async () => {
   const env = value === undefined ? {} : { POSIXLY_CORRECT: value };
   const files = { "/left": "a\nb\nc\n", [`/${option}`]: "b\n" };
   const information = await run([option], {}, env);
   assert.equal(information.exitCode, 0);
   assert.ok(information.stdout.includes(option === "--help" ? "Usage: comm" : "comm (safe-bash"));
   for (const first of ["left", "-"]) {
    for (const explicit of [false, true]) {
     const result = await run([...(explicit ? ["--"] : []), first, option], files, env, files["/left"]);
     assert.equal(result.exitCode, 0, result.stderr);
     assert.equal(result.stderr, "");
     assert.equal(result.stdout, explicit || value !== undefined ? "a\n\t\tb\nc\n" : information.stdout);
    }
   }
  });
 }
}

for (const value of [undefined, "", "1"]) {
 test(`comm operand ordering with POSIXLY_CORRECT=${JSON.stringify(value)}`, async () => {
  const env = value === undefined ? {} : { POSIXLY_CORRECT: value };
  const files = { "/one": "a\n", "/two": "x\n", "/-1": "x\n" };
  for (const args of [["one", "-1"], ["one", "two", "-1"]]) {
   const success = value !== undefined ? args.length === 2 : args.length === 3;
   const result = await run(args, files, env);
   assert.equal(result.exitCode, success ? 0 : 1, result.stderr);
   assert.equal(result.stdout, success ? value === undefined ? "x\n" : "a\n\tx\n" : "");
   assert.equal(result.stderr, success ? "" : "comm: EINVAL: comm requires exactly two files\n");
  }
  for (const [args, expected] of [
   [["--", "one", "-1"], "a\n\tx\n"],
   [["-1", "one", "two"], "x\n"],
   [["--output-delimiter", ":", "one", "two"], "a\n:x\n"],
  ] as const) {
   const result = await run([...args], files, env);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, expected);
   assert.equal(result.stderr, "");
  }
 });
}

for (const reverse of [false, true]) {
 test("comm detects disorder case 0 in either operand " + reverse, async () => {
  const files = { "/a": "b\nc\na\ne\n", "/b": "b\nc\nd\ne\n" };
  const args = reverse ? ["/b", "/a"] : ["/a", "/b"];
  const result = await run(args, files);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /not in sorted order/u);
  assert.equal((await run(["--nocheck-order", ...args], files)).exitCode, 0);
 });
}

for (const reverse of [false, true]) {
 const args = reverse ? ["/b", "/a"] : ["/a", "/b"];
 const files = { "/a": "b\na\n", "/b": "b\na\nc\n" };
 for (const flags of [[], ["--total"], ["-12"], ["-123", "--total"], ["--nocheck-order"]]) {
  test(`comm allows paired disorder before EOF with ${JSON.stringify(flags)}, reversed ${reverse}`, async () => {
   const result = await run([...flags, ...args], files);
   const common = flags.includes("-123") ? "" : flags.includes("-12") ? "b\na\n" : "\t\tb\n\t\ta\n";
   const unpaired = flags.includes("-12") || flags.includes("-123") ? "" : reverse ? "c\n" : "\tc\n";
   const total = flags.includes("--total") ? `${reverse ? "1\t0" : "0\t1"}\t2\ttotal\n` : "";
   assert.equal(result.stdout, common + unpaired + total);
   assert.equal(result.stderr, "");
   assert.equal(result.exitCode, 0);
  });
 }

 test(`comm strictly checks paired disorder before EOF, reversed ${reverse}`, async () => {
  const result = await run(["--check-order", ...args], files);
  assert.equal(result.stdout, "\t\tb\n");
  assert.ok(result.stderr.includes("file 1 is not in sorted order"));
  assert.equal(result.exitCode, 1);
 });

 test(`comm still detects disorder after an unpaired row, reversed ${reverse}`, async () => {
  const result = await run(args, { "/a": "a\nd\nc\n", "/b": "a\nb\n" });
  assert.equal(result.stdout, reverse ? "\t\ta\nb\n\td\n\tc\n" : "\t\ta\n\tb\nd\nc\n");
  assert.equal(result.stderr, `comm: file ${reverse ? 2 : 1} is not in sorted order\ncomm: input is not in sorted order\n`);
  assert.equal(result.exitCode, 1);
 });
}

test("fully paired disorder remains allowed by default", async () => {
 const files = { "/a": "c\na\nb\n", "/b": "c\na\nb\n" };
 assert.equal((await run(["/a", "/b"], files)).exitCode, 0);
 assert.equal((await run(["--check-order", "/a", "/b"], files)).exitCode, 1);
});

for (const file of [1, 2]) {
 test(`comm --check-order stops at disorder in file ${file} with a plain diagnostic`, async () => {
  const files = { "/a": "b\nc\nz\n", "/b": "b\nc\nz\n" };
  files[file === 1 ? "/a" : "/b"] = "b\nc\na\nz\n";
  const result = await run(["--check-order", "/a", "/b"], files);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "\t\tb\n\t\tc\n");
  assert.equal(result.stderr, `comm: file ${file} is not in sorted order\n`);
  assert.equal(result.combined, result.stdout + result.stderr);
 });
}

test("comm --check-order reports only the first disordered operand", async () => {
 const result = await run(["--check-order", "/a", "/b"], { "/a": "b\na\n", "/b": "b\na\n" });
 assert.equal(result.exitCode, 1);
 assert.equal(result.stdout, "\t\tb\n");
 assert.equal(result.stderr, "comm: file 1 is not in sorted order\n");
});

test("comm default order checking keeps its warning and final summary", async () => {
 const result = await run(["/a", "/b"], { "/a": "a\nd\nc\n", "/b": "a\nb\n" });
 assert.equal(result.exitCode, 1);
 assert.equal(result.stdout, "\t\ta\n\tb\nd\nc\n");
 assert.equal(result.stderr, "comm: file 1 is not in sorted order\ncomm: input is not in sorted order\n");
});

test("comm flushes produced rows before order diagnostics and summary", async () => {
 const result = await run(["/a", "/b"], { "/a": "a\nb\nc\nb\ne\n", "/b": "b\nc\nd\ne\n" });
 assert.ok(result.combined.startsWith("a\n\t\tb\n\t\tc\ncomm: file 1 is not in sorted order\n"), result.combined);
 assert.ok(result.combined.endsWith("\t\te\ncomm: input is not in sorted order\n"), result.combined);
});

for (const attached of [false, true]) {
 for (const total of [false, true]) {
  for (const delimiter of [Uint8Array.of(0xff), Uint8Array.of(0xfe, 0xff), new TextEncoder().encode("é"), new Uint8Array()]) {
   test(`comm preserves delimiter bytes ${[...delimiter]} with attached=${attached}, total=${total}`, async () => {
    const option = attached
     ? [shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode("--output-delimiter="), ...delimiter]))]
     : ["--output-delimiter", shellValueFromBytes(delimiter)];
    const result = await run([...option, ...option, ...(total ? ["--total"] : []), "/a", "/a"], { "/a": "x\n" });
    const separator = delimiter.length ? [...delimiter] : [0];
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, [
     ...separator, ...separator, 120, 10,
     ...(total ? [48, ...separator, 48, ...separator, 49, ...separator, ...new TextEncoder().encode("total\n")] : []),
    ]);
   });
  }
 }
}

for (const second of [Uint8Array.of(0xff), new TextEncoder().encode("�")]) {
 test(`comm rejects distinct delimiter bytes that decode identically: ${[...second]}`, async () => {
  const result = await run([
   "--output-delimiter", shellValueFromBytes(Uint8Array.of(0xfe)),
   shellValueFromBytes(Uint8Array.from([...new TextEncoder().encode("--output-delimiter="), ...second])),
   "/a", "/a",
  ], { "/a": "x\n" });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /multiple conflicting output delimiters/u);
  assert.deepEqual(result.stdoutBytes, []);
 });
}

test("comm requires an output delimiter argument", async () => {
 const result = await run(["/a", "/a", "--output-delimiter"], { "/a": "x\n" });
 assert.equal(result.exitCode, 1);
 assert.match(result.stderr, /requires an argument/u);
 assert.deepEqual(result.stdoutBytes, []);
});

for (const option of ["output-delimiter", "total", "check-order", "nocheck-order", "zero-terminated"]) {
 for (let length = 1; length <= option.length; length++) {
  const prefix = `--${option.slice(0, length)}`;
  test(`comm accepts GNU option prefix ${prefix}`, async () => {
   const args = option === "output-delimiter" ? [prefix, ":"] : [prefix];
   const input = option === "zero-terminated" ? "a\0" : "a\n";
   const expected = option === "output-delimiter" ? "::a\n"
    : option === "total" ? "\t\ta\n0\t0\t1\ttotal\n"
    : option === "zero-terminated" ? "\t\ta\0" : "\t\ta\n";
   const result = await run([...args, "/a", "/a"], { "/a": input });
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, expected);
   assert.equal(result.stderr, "");
  });
  if (option === "output-delimiter") {
   for (const delimiter of [":", "", "="]) {
    test(`comm accepts attached delimiter ${JSON.stringify(delimiter)} with ${prefix}`, async () => {
     const result = await run([`${prefix}=${delimiter}`, "/a", "/a"], { "/a": "a\n" });
     assert.equal(result.exitCode, 0, result.stderr);
     assert.equal(result.stdout, `${(delimiter || "\0").repeat(2)}a\n`);
     assert.equal(result.stderr, "");
    });
   }
  }
 }
}

for (const option of ["--unknown", "--output-delimiters=:", "--totals", "--check-orders", "--nocheck-orders", "--zero-terminator", "--=:", "--t=", "--check=yes", "--nocheck=yes", "--z="]) {
 test(`comm rejects invalid option ${option}`, async () => {
  const result = await run([option, "/a", "/a"], { "/a": "a\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("unsupported option"), result.stderr);
 });
}

test("comm requires an argument for an abbreviated output delimiter", async () => {
 const result = await run(["--out"], {});
 assert.equal(result.exitCode, 1);
 assert.equal(result.stdout, "");
 assert.ok(result.stderr.includes("requires an argument"), result.stderr);
});

test("comm preserves delimiter conflicts with abbreviated options", async () => {
 const result = await run(["--out=:", "--o=|", "/a", "/a"], { "/a": "a\n" });
 assert.equal(result.exitCode, 1);
 assert.equal(result.stdout, "");
 assert.ok(result.stderr.includes("multiple conflicting output delimiters"), result.stderr);
});

test("comm treats option prefixes after -- as filenames", async () => {
 const result = await run(["--", "--tot", "--out"], { "/--tot": "a\n", "/--out": "a\n" });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout, "\t\ta\n");
 assert.equal(result.stderr, "");
});

test("comm applies abbreviated order modes in argument order", async () => {
 const files = { "/a": "b\na\n" };
 for (const args of [["--check"], ["--nocheck", "--c"]]) {
  const result = await run([...args, "/a", "/a"], files);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "\t\tb\n");
  assert.equal(result.stderr, "comm: file 1 is not in sorted order\n");
 }
 const result = await run(["--check", "--n", "/a", "/a"], files);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout, "\t\tb\n\t\ta\n");
 assert.equal(result.stderr, "");
});

for (const env of [
 { LC_ALL: "en_US.utf8" },
 { LANG: "C", LC_COLLATE: "en_US.utf8" },
 { LANG: "en_US.UTF-8", LC_ALL: "", LC_COLLATE: "" },
]) {
 test(`comm uses selected collation for merging and order checks: ${JSON.stringify(env)}`, async () => {
  for (const mode of [[], ["--check-order"], ["--nocheck-order"]]) {
   const files = { "/a": "alpha\nBeta\n", "/b": "Beta\n" };
   const result = await run([...mode, "-12", "/a", "/b"], files, env);
   assert.equal(result.stdout, "Beta\n");
   assert.equal(result.stderr, "");
   assert.equal(result.exitCode, 0);
   const totals = await run([...mode, "-123", "--total", "/a", "/b"], files, env);
   assert.equal(totals.stdout, "1\t0\t1\ttotal\n");
   assert.equal(totals.stderr, "");
   assert.equal(totals.exitCode, 0);
  }
  for (const file of ["/a", "/b"]) {
   const result = await run(["--check-order", "/a", "/b"], { "/a": "", "/b": "", [file]: "Beta\nalpha\n" }, env);
   assert.equal(result.exitCode, 1);
   assert.equal(result.stderr, `comm: file ${file === "/a" ? 1 : 2} is not in sorted order\n`);
  }
 });
}

for (const locale of ["C", "POSIX", "C.UTF-8", "C.utf8", "C.UTF8", "C.utf-8"]) {
 test(`comm preserves byte ordering with ${locale} overriding LC_COLLATE`, async () => {
  const result = await run(["--check-order", "-12", "/a", "/b"], { "/a": "Beta\nalpha\n", "/b": "alpha\n" }, { LC_ALL: locale, LC_COLLATE: "en_US.utf8" });
  assert.equal(result.stdout, "alpha\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
 });
}

for (const locale of ["C.UTF8", "C.utf-8"]) {
 for (const env of [
  { LC_ALL: locale, LC_COLLATE: "en_US.utf8", LANG: "en_US.utf8" },
  { LC_ALL: "", LC_COLLATE: locale, LANG: "en_US.utf8" },
  { LC_ALL: "", LC_COLLATE: "", LANG: locale },
 ]) {
  test(`comm accepts C UTF-8 aliases: ${JSON.stringify(env)}`, async () => {
   const result = await run(["/left", "/right"], { "/left": "a\n", "/right": "a\n" }, env);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.deepEqual(result.stdoutBytes, [9, 9, 97, 10]);
   assert.equal(result.stderr, "");

   const ordered = await run(["--check-order", "/left", "/right"], {
    "/left": "Beta\nalpha\né\n", "/right": "alpha\né\n",
   }, env);
   assert.equal(ordered.exitCode, 0, ordered.stderr);
   assert.deepEqual(ordered.stdoutBytes, [...new TextEncoder().encode("Beta\n\t\talpha\n\t\té\n")]);
   assert.equal(ordered.stderr, "");
  });
 }
}

test("comm keeps delimiter equality byte based under locale collation", async () => {
 const result = await run(["--out=é", "--out=e\u0301", "/a", "/a"], { "/a": "x\n" }, { LC_ALL: "en_US.utf8" });
 assert.equal(result.exitCode, 1);
 assert.match(result.stderr, /multiple conflicting output delimiters/u);
});

test("comm distinguishes collation-equivalent text in NUL records", async () => {
 const result = await run(["-z12", "--check-order", "/a", "/b"], { "/a": "alpha\0é\0", "/b": "e\u0301\0" }, { LC_ALL: "en_US.utf8" });
 assert.equal(result.stdout, "");
 assert.equal(result.stderr, "");
 assert.equal(result.exitCode, 0);
});

for (const [first, second] of [["e\u0301", "é"], ["a", "a\u00ad"], ["a", "a\u200b"], ["a", "\ufeffa"]]) {
 for (const separator of ["\n", "\0"]) {
  for (const reverse of [false, true]) {
   test(`comm distinguishes Unicode records ${JSON.stringify([first, second])}, separator=${JSON.stringify(separator)}, reverse=${reverse}`, async () => {
    const left = reverse ? second! : first!, right = reverse ? first! : second!;
    const files = { "/a": left + separator, "/b": right + separator };
    const flags = separator === "\0" ? ["-z"] : [];
    for (const locale of ["en_US.utf8", "C"]) {
     const env = { LC_ALL: locale };
     for (const [options, expected] of [
      [["-12"], ""],
      [["-123", "--total"], `1\t1\t0\ttotal${separator}`],
      [[], `${reverse ? "\t" : ""}${first}${separator}${reverse ? "" : "\t"}${second}${separator}`],
     ] as const) {
      const result = await run([...flags, ...options, "/a", "/b"], files, env);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, [...new TextEncoder().encode(expected)]);
     }
     const identical = await run([...flags, "-12", "/a", "/a"], files, env);
     assert.deepEqual(identical.stdoutBytes, [...new TextEncoder().encode(left + separator)]);
     assert.equal(identical.exitCode, 0);
     assert.equal(identical.stderr, "");
     for (const file of ["/a", "/b"]) {
      const ordered = { "/a": "", "/b": "", [file]: first + separator + second + separator };
      const sorted = await run([...flags, "--check-order", "/a", "/b"], ordered, env);
      assert.equal(sorted.exitCode, 0, sorted.stderr);
      assert.equal(sorted.stderr, "");
      const disordered = { ...ordered, [file]: second + separator + first + separator };
      const unsorted = await run([...flags, "--check-order", "/a", "/b"], disordered, env);
      assert.equal(unsorted.exitCode, 1);
      assert.equal(unsorted.stderr, `comm: file ${file === "/a" ? 1 : 2} is not in sorted order\n`);
     }
    }
   });
  }
 }
}

// Expected byte output checked against GNU coreutils comm 9.4 (en_US.utf8).
for (const [left, right] of [
 ["a", "a\0"],
 ["a\0b", "ab"],
 ["a\0z", "ab"],
 ["a\0", "a\0\0"],
 ["", "\0"],
 ["\0a", "a"],
 ["a\0b", "a\0c"],
 ["a\0\0b", "a\0b"],
]) {
 test(`comm respects embedded NUL boundaries: ${JSON.stringify([left, right])}`, async () => {
  for (const locale of ["en_US.utf8", "C"]) {
   for (const reverse of [false, true]) {
    const files = { "/a": `${left}\n`, "/b": `${right}\n` };
    const args = reverse ? ["/b", "/a"] : ["/a", "/b"];
    const env = { LC_ALL: locale };
    for (const flags of [[], ["-12"], ["-123", "--total"]]) {
     const result = await run([...flags, ...args], files, env);
     const expected = flags.includes("--total") ? "1\t1\t0\ttotal\n"
      : flags.includes("-12") ? ""
      : reverse ? `\t${left}\n${right}\n` : `${left}\n\t${right}\n`;
     assert.deepEqual(result.stdoutBytes, [...new TextEncoder().encode(expected)]);
     assert.equal(result.stderr, "");
     assert.equal(result.exitCode, 0);
    }
   }
  }
 });
}

test("comm compares all embedded NUL portions using the selected locale", async () => {
 const result = await run(["--check-order", "--total", "/a", "/b"], {
  "/a": "a\0alpha\na\0Beta\na\0Beta\0\n",
  "/b": "a\0Beta\n",
 }, { LC_ALL: "en_US.utf8" });
 assert.deepEqual(result.stdoutBytes, [...new TextEncoder().encode("a\0alpha\n\t\ta\0Beta\na\0Beta\0\n2\t0\t1\ttotal\n")]);
 assert.equal(result.stderr, "");
 assert.equal(result.exitCode, 0);
});

for (const file of ["/a", "/b"]) {
 test(`comm checks embedded NUL order in ${file}`, async () => {
  for (const ordered of [true, false]) {
   const rows = ordered ? "a\0z\nab\n" : "ab\na\0z\n";
   const result = await run(["--check-order", "/a", "/b"], { "/a": "", "/b": "", [file]: rows }, { LC_ALL: "en_US.utf8" });
   assert.equal(result.exitCode, ordered ? 0 : 1);
   assert.equal(result.stderr, ordered ? "" : `comm: file ${file === "/a" ? 1 : 2} is not in sorted order\n`);
   const prefix = file === "/a" ? "" : "\t";
   assert.deepEqual(result.stdoutBytes, [...new TextEncoder().encode(ordered ? `${prefix}a\0z\n${prefix}ab\n` : `${prefix}ab\n`)]);
  }
 });
}

for (const env of [
 { LC_ALL: "does_not_exist" },
 { LC_ALL: "invalid_locale" },
 { LC_ALL: "en_US.utf8@unsupported" },
 { LANG: "does_not_exist", LC_COLLATE: "en_US.utf8" },
 ...["LC_CTYPE", "LC_COLLATE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME",
  "LC_PAPER", "LC_NAME", "LC_ADDRESS", "LC_TELEPHONE", "LC_MEASUREMENT", "LC_IDENTIFICATION"]
  .map(category => ({ LANG: "C", LC_ALL: "", LC_COLLATE: "en_US.utf8", [category]: "does_not_exist" })),
]) {
 test(`comm falls back to C when locale initialization fails: ${JSON.stringify(env)}`, async () => {
  const result = await run(["/a", "/b"], { "/a": "Z\n", "/b": "a\n" }, env);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdoutBytes, [0x5a, 0x0a, 0x09, 0x61, 0x0a]);

  for (const separator of ["\n", "\0"]) {
   const args = [...(separator === "\0" ? ["-z"] : []), "--check-order", "/a", "/b"];
   const ordered = await run(args, { "/a": `Z${separator}a${separator}`, "/b": "" }, env);
   assert.equal(ordered.exitCode, 0, ordered.stderr);
   assert.equal(ordered.stderr, "");
   assert.equal(ordered.stdout, `Z${separator}a${separator}`);
   const disordered = await run(args, { "/a": `a${separator}Z${separator}`, "/b": "" }, env);
   assert.equal(disordered.exitCode, 1);
   assert.equal(disordered.stderr, "comm: file 1 is not in sorted order\n");
   assert.equal(disordered.stdout, `a${separator}`);
  }
 });
}

for (const [locale, expected] of [["C", "Z\n\ta\n"], ["en_US.utf8", "\ta\nZ\n"]]) {
 test(`comm preserves valid ${locale} ordering and locale precedence`, async () => {
  for (const env of [
   { LC_ALL: locale! },
   { LANG: "does_not_exist", LC_COLLATE: "does_not_exist", LC_TIME: "does_not_exist", LC_ALL: locale! },
   { LANG: locale!, LC_ALL: "", LC_TIME: "", LC_COLLATE: "", LC_UNKNOWN: "does_not_exist" },
  ]) {
   const result = await run(["/a", "/b"], { "/a": "Z\n", "/b": "a\n" }, env);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stderr, "");
   assert.equal(result.stdout, expected);
  }
 });
}

for (const option of ["help", "version"]) {
 for (let length = 1; length <= option.length; length++) {
  const prefix = `--${option.slice(0, length)}`;
  test(`comm information prefix ${prefix} matches its full spelling`, async () => {
   const expected = await run([`--${option}`], {});
   assert.equal(expected.exitCode, 0);
   assert.notEqual(expected.stdout, "");
   assert.equal(expected.stderr, "");
   for (const before of [[], ["--tot"], ["--total"], ["--z"], ["--zero-terminated"], ["--c"], ["--n"], ["--out=:"], ["--out", ":"], ["-123z"], ["missing"], ["-"]]) {
    assert.deepEqual(await run([...before, prefix], {}), expected, JSON.stringify(before));
   }
  });
 }
}

for (const option of ["--he", "--help", "--ver", "--version"]) {
 test(`comm keeps ${option} literal after option boundaries`, async () => {
  const files = { "/left": "a\n", [`/${option}`]: "x\n" };
  const expected = await run(["left", option.slice(2)], { "/left": "a\n", [`/${option.slice(2)}`]: "x\n" });
  assert.equal(expected.exitCode, 0);
  assert.equal(expected.stdout, "a\n\tx\n");
  assert.deepEqual(await run(["--", "left", option], files), expected);
  for (const posix of ["", "1"]) {
   assert.deepEqual(await run(["left", option], files, { POSIXLY_CORRECT: posix }), expected);
   const stdin = await run(["-", option], files, { POSIXLY_CORRECT: posix });
   assert.equal(stdin.exitCode, 0, stdin.stderr);
   assert.equal(stdin.stdout, "\tx\n");
   assert.equal(stdin.stderr, "");
  }
 });
 test(`comm consumes ${option} as a required delimiter argument`, async () => {
  const files = { "/left": "a\n", "/right": "a\n" };
  for (const args of [["--out", option], [`--out=${option}`], ["--output-delimiter", option]]) {
   const result = await run([...args, "left", "right"], files);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, `${option}${option}a\n`);
   assert.equal(result.stderr, "");
   assert.deepEqual(await run([...args, "--ver"], {}), await run(["--version"], {}));
  }
 });
}

test("comm information scan respects option order and invalid options", async () => {
 for (const [first, second] of [["--he", "--ver"], ["--ver", "--he"]]) {
  const full = first === "--he" ? "--help" : "--version";
  assert.deepEqual(await run([first!, second!], {}), await run([full], {}));
 }
 for (const invalid of ["--he=yes", "--ver=", "--tot=yes", "--z=", "--unknown", "--helpful"]) {
  const result = await run([invalid, "--he"], {});
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
 }
});
