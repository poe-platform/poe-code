import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createTsortCommand } from "./index.js";

for (const locale of ["C", "C.UTF-8"]) {
 for (const args of [[""], [], ["-"], ["."]]) {
  test(`tsort input selection: ${JSON.stringify(args)} (${locale})`, async () => {
   const values = createCommandArguments(args);
   let stdout = "";
   let stderr = "";
   const result = await createTsortCommand().execute({
    command: "tsort", args: values.args, argumentValues: values, cwd: "/",
    env: { LC_ALL: locale }, fs: createMemoryFileSystem(), stdin: toByteSource("a b"),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
   });
   const readsStdin = args.length === 0 || args[0] === "-";
   assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, {
    exitCode: readsStdin ? 0 : 1,
    stdout: readsStdin ? "a\nb\n" : "",
    stderr: readsStdin ? "" : args[0] === ""
     ? "tsort: '': No such file or directory\n"
     : "tsort: .: read error: Is a directory\n",
   });
  });
 }
}

for (const operand of [".", "empty"]) {
 test(`tsort distinguishes a directory from an empty file: ${operand}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  const values = createCommandArguments([operand]);
  let stdout = "";
  let stderr = "";
  const result = await createTsortCommand().execute({
   command: "tsort", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs, stdin: toByteSource(""),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, {
   exitCode: operand === "." ? 1 : 0,
   stdout: "",
   stderr: operand === "." ? "tsort: .: read error: Is a directory\n" : "",
  });
 });
}

for (const [args, expected] of [
  [["--help"], "Usage: tsort"],
  [["--he"], "Usage: tsort"],
  [["f", "--help"], "Usage: tsort"],
  [["--help", "f"], "Usage: tsort"],
  [["f", "--h"], "Usage: tsort"],
  [["missing", "--help"], "Usage: tsort"],
  [["f", "extra", "--help"], "Usage: tsort"],
  [["--help", "--"], "Usage: tsort"],
  [["--help", "--version"], "Usage: tsort"],
  [["--help", "--bogus"], "Usage: tsort"],
  [["--version"], "tsort (virtual-bash)"],
  [["f", "--version"], "tsort (virtual-bash)"],
  [["--version", "f"], "tsort (virtual-bash)"],
  [["f", "--v"], "tsort (virtual-bash)"],
  [["--version", "--help"], "tsort (virtual-bash)"],
  [["--version", "--"], "tsort (virtual-bash)"],
] as const) {
  test(`tsort honors the first information option: ${args.join(" ")}`, async () => {
    const values = createCommandArguments([...args]);
    let stdout = "";
    let stderr = "";
    const result = await createTsortCommand().execute({
      command: "tsort", args: values.args, argumentValues: values, cwd: "/", env: {},
      get fs(): never { throw new Error("information options must not access the filesystem"); },
      get stdin(): never { throw new Error("information options must not read stdin"); },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.ok(stdout.startsWith(expected), stdout);
    assert.equal(stderr, "");
  });
}

for (const [args, posix, exitCode, expected] of [
  [["--", "--help"], false, 0, "a\nb\n"],
  [["--", "--version"], false, 0, "a\nb\n"],
  [["f", "--", "--help"], false, 1, "extra operand '--help'"],
  [["f", "--help"], true, 1, "extra operand '--help'"],
  [["f", "--version"], true, 1, "extra operand '--version'"],
  [["--help", "f"], true, 0, "Usage: tsort"],
  [["--v", "f"], true, 0, "tsort (virtual-bash)"],
  [["--bogus", "--help"], false, 1, "unrecognized option '--bogus'"],
  [["-x", "--help"], false, 1, "invalid option -- 'x'"],
  [["--help=foo"], false, 1, "unrecognized option '--help=foo'"],
] as const) {
  test(`tsort respects parsing boundaries: ${args.join(" ")} (POSIX=${posix})`, async () => {
    const fs = createMemoryFileSystem();
    for (const file of ["f", "--help", "--version"]) {
      await fs.writeFile(`/${file}`, new TextEncoder().encode("a b"));
    }
    const values = createCommandArguments([...args]);
    let stdout = "";
    let stderr = "";
    const result = await createTsortCommand().execute({
      command: "tsort", args: values.args, argumentValues: values, cwd: "/",
      env: posix ? { POSIXLY_CORRECT: "1" } : {}, fs, stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, exitCode, stderr);
    if (exitCode === 0) {
      assert.ok(stdout.startsWith(expected), stdout);
      assert.equal(stderr, "");
    } else {
      assert.equal(stdout, "");
      assert.equal(stderr, `tsort: ${expected}\nTry 'tsort --help' for more information.\n`);
    }
  });
}
