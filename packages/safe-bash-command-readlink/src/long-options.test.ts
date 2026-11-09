import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createReadlinkCommand } from "./index.js";

async function run(args: string[], env: Record<string, string> = {}) {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/file", new Uint8Array());
 await fs.symlink("file", "/link");
 await fs.symlink("file", "/--canonicalize-e");
 await fs.symlink("file", "/--he");
 await fs.symlink("file", "/--vers");
 const values = createCommandArguments(args);
 let stdout = "";
 let stderr = "";
 const result = await createReadlinkCommand().execute({
  command: "readlink", args: values.args, argumentValues: values, cwd: "/", env,
  fs, stdin: toByteSource(""),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 return { exitCode: result.exitCode, stdout, stderr };
}

for (const [abbreviation, full, stdout] of [
 ["--canonicalize-e", "--canonicalize-existing", "/file\n"],
 ["--canonicalize-m", "--canonicalize-missing", "/file\n"],
 ["--no-n", "--no-newline", "file"],
 ["--qu", "--quiet", "file\n"],
 ["--s", "--silent", "file\n"],
 ["--ze", "--zero", "file\0"],
] as const) {
 test(`readlink accepts ${abbreviation}`, async () => {
  const result = await run([abbreviation, "link"]);
  assert.deepEqual(result, { exitCode: 0, stdout, stderr: "" });
  assert.deepEqual(result, await run([full, "link"]));
 });
}

for (const [abbreviation, full] of [["--he", "--help"], ["--vers", "--version"]] as const) {
 for (const preceding of [[], ["--canonicalize-e"], ["--qu"]]) {
  test(`readlink ${[...preceding, abbreviation].join(" ")} matches ${full}`, async () => {
   const expected = await run([full]);
   assert.equal(expected.exitCode, 0);
   assert.notEqual(expected.stdout, "");
   assert.deepEqual(await run([...preceding, abbreviation, "--invalid"]), expected);
  });
 }
}

for (const argument of ["--can", "--v", "--unknown", "--no-n=value", "--he=value", "--vers=value"]) {
 test(`readlink rejects ${argument}`, async () => {
  const result = await run([argument, "link"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.notEqual(result.stderr, "");
 });
}

for (const args of [
 ["--canonicalize-e", "-m"],
 ["-e", "--canonicalize-m"],
 ["--canonicalize-existing", "--canonicalize-m"],
 ["--canonicalize-m", "--canonicalize-e", "--canonicalize-m"],
]) {
 test(`readlink keeps the last canonicalization flag in ${args.join(" ")}`, async () => {
  assert.deepEqual(await run([...args, "missing/leaf"]), { exitCode: 0, stdout: "/missing/leaf\n", stderr: "" });
 });
}

for (const args of [["--canonicalize-m", "-e"], ["-m", "--canonicalize-e"], ["--canonicalize-m", "--canonicalize"]]) {
 test(`readlink rejects missing parents with ${args.join(" ")}`, async () => {
  assert.deepEqual(await run([...args, "missing/leaf"]), { exitCode: 1, stdout: "", stderr: "" });
 });
}

test("readlink leaves abbreviated options after -- as filenames", async () => {
 assert.deepEqual(await run(["--", "--canonicalize-e", "--he", "--vers"]), {
  exitCode: 0, stdout: "file\nfile\nfile\n", stderr: "",
 });
});

for (const quiet of ["--qu", "--s"]) {
 test(`readlink ${quiet} overrides verbose mode`, async () => {
  assert.deepEqual(await run(["--verb", quiet, "missing"]), { exitCode: 1, stdout: "", stderr: "" });
  const verbose = await run([quiet, "--verb", "missing"]);
  assert.equal(verbose.exitCode, 1);
  assert.notEqual(verbose.stderr, "");
 });
}

test("readlink leaves abbreviations after the first POSIX operand as filenames", async () => {
 for (const POSIXLY_CORRECT of ["1", ""]) {
  assert.deepEqual(await run(["link", "--canonicalize-e", "--he", "--vers"], { POSIXLY_CORRECT }), {
   exitCode: 0, stdout: "file\nfile\nfile\nfile\n", stderr: "",
  });
  assert.deepEqual(await run(["--canonicalize-e", "link"], { POSIXLY_CORRECT }), {
   exitCode: 0, stdout: "/file\n", stderr: "",
  });
 }
});

test("readlink accepts abbreviations after operands outside POSIX mode", async () => {
 assert.deepEqual(await run(["link", "--canonicalize-e"]), { exitCode: 0, stdout: "/file\n", stderr: "" });
 assert.deepEqual(await run(["link", "--he"]), await run(["--help"]));
});

test("readlink rejects invalid options before abbreviated information options", async () => {
 for (const option of ["--can", "--v", "-Q", "--no-n=value"]) {
  const result = await run([option, "--he"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.notEqual(result.stderr, "");
 }
});
