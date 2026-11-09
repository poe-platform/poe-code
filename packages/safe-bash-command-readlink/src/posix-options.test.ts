import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createReadlinkCommand } from "./index.js";

async function run(args: readonly string[], env: Record<string, string> = {}) {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/file", new Uint8Array());
 for (const name of ["link", "-"]) await fs.symlink("file", `/${name}`);
 for (const name of ["-f", "--canonicalize", "-n", "-z", "--"]) await fs.symlink("p/x", `/${name}`);
 for (const name of ["--help", "--version"]) await fs.symlink("dir", `/${name}`);
 const values = createCommandArguments(args);
 let stdout = "", stderr = "";
 const result = await createReadlinkCommand().execute({
  command: "readlink", args: values.args, argumentValues: values, cwd: "/", env,
  fs, stdin: toByteSource(""),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 return { exitCode: result.exitCode, stdout, stderr };
}

test("readlink stops parsing options after the first POSIX operand", async () => {
 for (const POSIXLY_CORRECT of ["1", ""]) {
  for (const operand of ["link", "-"]) {
   for (const option of ["-f", "--canonicalize", "-n", "-z", "--"]) {
    assert.deepEqual(await run([operand, option], { POSIXLY_CORRECT }), {
     exitCode: 0, stdout: "file\np/x\n", stderr: "",
    });
   }
   for (const option of ["--help", "--version"]) {
    assert.deepEqual(await run([operand, option], { POSIXLY_CORRECT }), {
     exitCode: 0, stdout: "file\ndir\n", stderr: "",
    });
   }
  }
 }
});

test("readlink applies only options preceding the POSIX operand", async () => {
 assert.deepEqual(await run(["-mz", "link", "-f"], { POSIXLY_CORRECT: "1" }), {
  exitCode: 0, stdout: "/file\0/p/x\0", stderr: "",
 });
});

test("readlink retains default option permutation and canonical mode ordering", async () => {
 assert.deepEqual(await run(["link", "-f"]), { exitCode: 0, stdout: "/file\n", stderr: "" });
 for (const env of [{}, { POSIXLY_CORRECT: "1" }]) {
  for (const args of [["-ef", "missing"], ["-e", "--canonicalize", "missing"]]) {
   assert.deepEqual(await run(args, env), { exitCode: 0, stdout: "/missing\n", stderr: "" });
  }
  const missing = await run(["-fe", "missing"], env);
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr.length > 0, env.POSIXLY_CORRECT !== undefined);
 }
});

test("readlink honors the explicit option terminator", async () => {
 for (const env of [{}, { POSIXLY_CORRECT: "1" }]) {
  assert.deepEqual(await run(["--", "link", "-f", "--help", "--version"], env), {
   exitCode: 0, stdout: "file\np/x\ndir\ndir\n", stderr: "",
  });
 }
});

test("readlink information options work before POSIX operands and after default operands", async () => {
 for (const option of ["--help", "--version"]) {
  const information = await run([option], { POSIXLY_CORRECT: "1" });
  assert.equal(information.exitCode, 0);
  assert.ok(information.stdout.startsWith(option === "--help" ? "Usage: readlink " : "readlink ("));
  assert.equal(information.stderr, "");
  assert.deepEqual(await run([option, "link"], { POSIXLY_CORRECT: "1" }), information);
  assert.deepEqual(await run(["link", option]), information);
 }
});
