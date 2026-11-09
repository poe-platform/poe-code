import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createReadlinkCommand } from "./index.js";

for (const mode of ["-e", "-f", "-m"]) {
 for (const length of [40, 41, 65]) {
  test(`readlink ${mode} resolves ${length} acyclic symlinks`, async () => {
   const fs = createMemoryFileSystem();
   await fs.mkdir("/dir");
   await fs.writeFile("/dir/file", new Uint8Array());
   for (let index = length - 1; index >= 0; index--) {
    await fs.symlink(index === length - 1 ? "dir" : `hop${index + 1}`, `/hop${index}`);
   }
   for (const [operand, expected] of [["hop0", "/dir"], ["hop0/file", "/dir/file"], ["hop0/../hop0/file", "/dir/file"]]) {
    const result = await readlink(fs, [mode, operand!]);
    assert.deepEqual(result, { exitCode: 0, stdout: `${expected}\n`, stderr: "" });
   }
   await fs.symlink("dir/file", "/file-link");
   await fs.rm(`/hop${length - 1}`);
   await fs.symlink("/file-link", `/hop${length - 1}`);
   assert.deepEqual(await readlink(fs, [mode, "hop0"]), { exitCode: 0, stdout: "/dir/file\n", stderr: "" });
  });
 }
}

for (const mode of ["-e", "-f"]) {
 test(`readlink ${mode} rejects real cycles and invalid ancestors after long chains`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  for (let index = 0; index < 65; index++) await fs.symlink(`hop${index + 1}`, `/hop${index}`);
  await fs.symlink("b", "/a");
  await fs.symlink("a", "/b");
  for (const target of ["a", "missing/child", "missing/../file", "file/child", "file/"]) {
   await fs.symlink(target, "/hop65");
   const result = await readlink(fs, [mode, "hop0"]);
   assert.equal(result.exitCode, 1, target);
   assert.equal(result.stdout, "", target);
   assert.equal(result.stderr, "");
   await fs.rm("/hop65");
  }
  for (const target of ["missing", "missing/"]) {
   await fs.symlink(target, "/hop65");
   const result = await readlink(fs, [mode, "hop0"]);
   assert.equal(result.exitCode, mode === "-f" ? 0 : 1);
   assert.equal(result.stdout, mode === "-f" ? "/missing\n" : "");
   await fs.rm("/hop65");
  }
 });
}

async function readlink(fs: ReturnType<typeof createMemoryFileSystem>, args: string[]) {
 const values = createCommandArguments(args);
 let stdout = "";
 let stderr = "";
 const result = await createReadlinkCommand().execute({
  command: "readlink", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs, stdin: toByteSource(""),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 return { exitCode: result.exitCode, stdout, stderr };
}
