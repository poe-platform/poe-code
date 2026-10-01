import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, FsError, toByteSource, type FileSystem } from "safe-bash-contracts";
import { createSha512sumCommand, type Sha512sumCommandsOptions } from "./index.js";

async function run(fs: FileSystem, args: string[], signal = new AbortController().signal, options: Sha512sumCommandsOptions = {}) {
  let stdout = "", stderr = "";
  const values = createCommandArguments(args);
  const result = await createSha512sumCommand(options).execute({
    command: "sha512sum", args: values.args, argumentValues: values,
    cwd: "/", env: {}, fs, signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

test("sha512sum preserves directory and permission diagnostics", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/directory");
  const directory = await run(fs, ["/directory"]);
  assert.equal(directory.exitCode, 1);
  assert.ok(directory.stderr.includes("Is a directory"), directory.stderr);
  const denied = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "readStream") return () => { throw new FsError("EACCES"); };
    return Reflect.get(target, key);
  } });
  const permission = await run(denied, ["/private"]);
  assert.equal(permission.exitCode, 1);
  assert.ok(permission.stderr.includes("EACCES"), permission.stderr);
});

test("sha512sum propagates cancellation during filesystem reads", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel digest");
  const fs = new Proxy(createMemoryFileSystem(), { get(target, key) {
    if (key === "readFile" || key === "readStream") return () => { controller.abort(reason); throw reason; };
    return Reflect.get(target, key);
  } });
  await assert.rejects(run(fs, ["/input"], controller.signal), error => error === reason);
});

test("sha512sum preserves explicit input limit diagnostics", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("abc"));
  const result = await run(fs, ["/input"], undefined, { maxInputBytes: 2 });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("limit"), result.stderr);
  assert.ok(!result.stderr.includes("No such file"), result.stderr);
});
