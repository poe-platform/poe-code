import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, FsError, toByteSource, type FileSystem } from "safe-bash-contracts";
import { createSha512sumCommand, type Sha512sumCommandsOptions } from "./index.js";

async function run(fs: FileSystem, args: string[], signal = new AbortController().signal, options: Sha512sumCommandsOptions = {}, stdin = toByteSource("")) {
  let stdout = "", stderr = "";
  const values = createCommandArguments(args);
  const result = await createSha512sumCommand(options).execute({
    command: "sha512sum", args: values.args, argumentValues: values,
    cwd: "/", env: {}, fs, signal, stdin,
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

for (const flag of ["--status", "--quiet", "--strict", "--warn", "-w", "--ignore-missing"]) {
  test(`rejects ${flag} without check`, async () => {
    const result = await run(createMemoryFileSystem(), [flag]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("require --check"), result.stderr);
  });
}
test("stdin stops at first over-budget chunk and closes source", async () => {
  let pulls = 0, closed = false;
  async function* input() {
    try { for (let i = 0; i < 100; i++) { pulls++; yield new Uint8Array(3); } }
    finally { closed = true; }
  }
  const result = await run(createMemoryFileSystem(), [], undefined, { maxInputBytes: 5 }, input());
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("limit"), result.stderr);
  assert.equal(pulls, 2);
  assert.equal(closed, true);
});
for (const target of ["directory", "oversized", "missing"]) {
  test(`ignore-missing handles ${target} correctly`, async () => {
    const fs = createMemoryFileSystem();
    const digest = "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e";
    await fs.writeFile("/empty", new Uint8Array());
    await fs.mkdir("/directory");
    await fs.writeFile("/oversized", new Uint8Array(1000));
    await fs.writeFile("/manifest", new TextEncoder().encode(`${digest}  /empty\n${digest}  /${target}\n`));
    const result = await run(fs, ["-c", "--ignore-missing", "/manifest"], undefined, { maxInputBytes: 500 });
    assert.equal(result.exitCode, target === "missing" ? 0 : 1);
    if (target !== "missing") {
      assert.ok(result.stderr.includes(target === "directory" ? "Is a directory" : "limit"), result.stderr);
      assert.ok(!result.stderr.includes("No such file"), result.stderr);
    }
  });
}
