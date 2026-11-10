import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPasteCommand } from "./index.js";

async function run(args: string[], files: Record<string, string>, stdin = "", env: Record<string, string> = {}) {
 const fs = createMemoryFileSystem();
 for (const [path, content] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(content));
 const values = createCommandArguments(args);
 let stdout = "", stderr = "";
 const result = await createPasteCommand().execute({
  command: "paste", args: values.args, argumentValues: values, cwd: "/", env, fs,
  stdin: toByteSource(stdin), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
 });
 return { ...result, stdout, stderr };
}

for (const option of ["help", "version"]) {
 for (let length = 1; length <= option.length; length++) {
  const prefix = `--${option.slice(0, length)}`;
  test(`paste information prefix ${prefix} matches its full spelling`, async () => {
   const expected = await run([`--${option}`], {});
   assert.equal(expected.exitCode, 0);
   assert.notEqual(expected.stdout, "");
   for (const before of [[], ["--ser"], ["--z"], ["--del=:"], ["--del", ":"], ["-sd:"], ["missing"]]) {
    assert.deepEqual(await run([...before, prefix], {}), expected, JSON.stringify(before));
   }
  });
 }
}

for (const option of ["--he", "--help", "--vers", "--version"]) {
 test(`paste keeps ${option} literal after option boundaries`, async () => {
  const files = { "/rows": "a\nb\n", [`/${option}`]: "x\ny\n" };
  assert.deepEqual(await run(["--", option], files), { exitCode: 0, stdout: "x\ny\n", stderr: "" });
  for (const posix of ["", "1"]) {
   for (const operand of ["rows", "-"]) {
    assert.deepEqual(await run([operand, option], files, "a\nb\n", { POSIXLY_CORRECT: posix }),
     { exitCode: 0, stdout: "a\tx\nb\ty\n", stderr: "" });
   }
  }
 });
 test(`paste consumes ${option} as a required delimiter argument`, async () => {
  for (const args of [["--del", option], [`--del=${option}`], ["-d", option], [`-d${option}`], ["-sd", option]]) {
   assert.deepEqual(await run(["-s", ...args], {}, "a\nb\n"),
    { exitCode: 0, stdout: "a-b\n", stderr: "" });
   assert.deepEqual(await run([...args, "--vers"], {}), await run(["--version"], {}));
  }
 });
}

test("paste information scan respects option order and invalid options", async () => {
 for (const [first, second] of [["--he", "--vers"], ["--vers", "--he"]]) {
  const full = first === "--he" ? "--help" : "--version";
  assert.deepEqual(await run([first!, second!], {}), await run([full], {}));
 }
 for (const invalid of ["--he=yes", "--vers=", "--ser=yes", "--unknown", "--helpful"]) {
  const result = await run([invalid, "--he"], {});
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
 }
});

for (const option of ["serial", "delimiters", "zero-terminated"]) {
 for (let length = 1; length <= option.length; length++) {
  const prefix = `--${option.slice(0, length)}`;
  test(`paste accepts GNU option prefix ${prefix}`, async () => {
   const args = option === "serial" ? [prefix, "-"]
    : option === "delimiters" ? ["-s", prefix, ":", "-"] : ["-s", prefix, "-"];
   const input = option === "zero-terminated" ? "a\0b\0" : "a\nb\n";
   const expected = option === "serial" ? "a\tb\n"
    : option === "delimiters" ? "a:b\n" : "a\tb\0";
   const result = await run(args, {}, input);
   assert.equal(result.exitCode, 0, result.stderr);
   assert.equal(result.stdout, expected);
   assert.equal(result.stderr, "");
  });
  if (option === "delimiters") {
   for (const delimiter of [":", "", "="]) {
    test(`paste accepts attached delimiter ${JSON.stringify(delimiter)} with ${prefix}`, async () => {
     const result = await run(["-s", `${prefix}=${delimiter}`, "-"], {}, "a\nb\n");
     assert.equal(result.exitCode, 0, result.stderr);
     assert.equal(result.stdout, `a${delimiter}b\n`);
     assert.equal(result.stderr, "");
    });
   }
  }
 }
}

for (const [args, message] of [
 [["-x"], "invalid option -- 'x'"],
 [["-sx"], "invalid option -- 'x'"],
 [["-xy"], "invalid option -- 'x'"],
 [["--bad"], "unrecognized option '--bad'"],
 [["--unknown"], "unrecognized option '--unknown'"],
 [["--serially"], "unrecognized option '--serially'"],
 [["--delimiters-extra=:"], "unrecognized option '--delimiters-extra=:'"],
 [["--zero-terminator"], "unrecognized option '--zero-terminator'"],
 [["--=:"], "option '--=:' is ambiguous; possibilities: '--serial' '--delimiters' '--zero-terminated' '--help' '--version'"],
 [["-d"], "option requires an argument -- 'd'"],
 [["-sd"], "option requires an argument -- 'd'"],
 [["--delimiters"], "option '--delimiters' requires an argument"],
 [["--delim"], "option '--delimiters' requires an argument"],
 [["--serial=yes"], "option '--serial' doesn't allow an argument"],
 [["--s="], "option '--serial' doesn't allow an argument"],
 [["--ser=yes"], "option '--serial' doesn't allow an argument"],
 [["--z="], "option '--zero-terminated' doesn't allow an argument"],
 [["--zero-t=yes"], "option '--zero-terminated' doesn't allow an argument"],
 [["--he=yes"], "option '--help' doesn't allow an argument"],
 [["--vers="], "option '--version' doesn't allow an argument"],
 [["-x", "--help"], "invalid option -- 'x'"],
 [["--bad", "--version"], "unrecognized option '--bad'"],
] as const) {
 test(`paste reports GNU usage diagnostic for ${JSON.stringify(args)}`, async () => {
  assert.deepEqual(await run([...args], {}, "x\ny\nz\n", { LC_ALL: "C" }), {
   exitCode: 1,
   stdout: "",
   stderr: `paste: ${message}\nTry 'paste --help' for more information.\n`,
  });
 });
}

test("paste still merges files with an explicit delimiter in the C locale", async () => {
 assert.deepEqual(await run(["-d", ":", "a", "b"], { "/a": "A\nB\nC", "/b": "1\n2\n" }, "x\ny\nz\n", { LC_ALL: "C" }), {
  exitCode: 0, stdout: "A:1\nB:2\nC:\n", stderr: "",
 });
});

test("paste treats option prefixes after -- as filenames", async () => {
 const result = await run(["-s", "--", "--ser"], { "/--ser": "a\nb\n" });
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout, "a\tb\n");
 assert.equal(result.stderr, "");
});
