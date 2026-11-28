import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type FileSystem } from "safe-bash-contracts";
import { createTarCommand } from "./index.js";

async function run(fs: FileSystem, args: string[]) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createTarCommand().execute({
    command: "tar", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { ...result, stdout, stderr };
}

for (const members of [["a", "nope"], ["nope", "a"], ["nope"], ["a"]]) {
  test(`tar --ignore-failed-read creates a readable archive from ${members.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a", new TextEncoder().encode("hi\n"));
    const created = await run(fs, ["cf", "t.tar", ...members, "--ignore-failed-read"]);
    assert.deepEqual(created, {
      exitCode: 0, stdout: "",
      stderr: members.includes("nope") ? "tar: nope: Warning: Cannot stat: No such file or directory\n" : "",
    });
    assert.deepEqual(await run(fs, ["tf", "t.tar"]), {
      exitCode: 0, stdout: members.includes("a") ? "a\n" : "", stderr: "",
    });
    if (members.includes("a")) assert.deepEqual(await run(fs, ["xOf", "t.tar", "a"]), {
      exitCode: 0, stdout: "hi\n", stderr: "",
    });
  });
}

test("tar --ignore-failed-read does not hide an invalid archive destination", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new TextEncoder().encode("hi\n"));
  await fs.mkdir("/t.tar");
  const result = await run(fs, ["cf", "t.tar", "--ignore-failed-read", "a"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "tar: output archive must be a regular file, not a symlink or directory\n");
});
