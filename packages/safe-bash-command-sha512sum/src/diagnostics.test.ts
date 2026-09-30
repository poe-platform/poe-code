import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, FsError, toByteSource, type FileSystem } from "safe-bash-contracts";
import { createSha512sumCommand } from "./index.js";

async function run(fs: FileSystem, args: string[], signal = new AbortController().signal) {
  let stdout = "", stderr = "";
  const values = createCommandArguments(args);
  const result = await createSha512sumCommand().execute({
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
  assert.ok(directory.stderr.includes("EISDIR"), directory.stderr);
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
