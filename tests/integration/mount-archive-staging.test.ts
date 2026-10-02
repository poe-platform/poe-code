import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { createMemoryFileSystem, createMountFileSystem, createReadOnlyFileSystem, type FileSystem } from "@poe-code/safe-fs/core";
import { createTarCommand } from "safe-bash-command-tar";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";

async function tar(fs: FileSystem, args: string[]) {
  const values = createCommandArguments(args);
  let stderr = "";
  const result = await createTarCommand().execute({
    command: "tar", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: toByteSource(""), stdout: { async write() {} },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stderr };
}

for (const nested of [false, true]) for (const replaceAncestor of [false, true]) {
  test(`tar extracts with read-only system skills: nested=${nested}, ancestor replacement=${replaceAncestor}`, async () => {
    const skills = createMemoryFileSystem();
    await skills.mkdir("/source/sub", { recursive: true });
    const payload = new TextEncoder().encode("archive payload");
    await skills.writeFile("/source/sub/file", payload);
    const created = await tar(skills, ["-cf", "/input.tar", "-C", "/source", "sub"]);
    assert.equal(created.exitCode, 0, created.stderr);
    const archive = await skills.readFile("/input.tar");
    const root = createMemoryFileSystem();
    if (nested) await root.mkdir("/skills");
    const writable = nested ? createMemoryFileSystem() : root;
    await writable.mkdir("/work");
    let publications = 0;
    const publish = writable.publishStagedFile.bind(writable);
    vi.spyOn(writable, "publishStagedFile").mockImplementation(async (...args) => {
      publications++;
      if (replaceAncestor) {
        await writable.rename("/work/sub", "/work/old");
        await writable.mkdir("/work/sub");
      }
      return publish(...args);
    });
    const fs = createMountFileSystem({ root: nested ? root : writable, mounts: {
      "/skills/.system": createReadOnlyFileSystem(skills),
      ...(nested ? { "/skills/user": writable } : {}),
    } });
    const result = await tar(fs, ["-xf", "/skills/.system/input.tar", "-C", nested ? "/skills/user/work" : "/work"]);
    if (nested) {
      // Nested publication is supported, but extraction also mutates directories
      // and metadata whose contract cannot guard ancestors on another backend.
      assert.equal(result.exitCode, 2);
      assert.equal(publications, 0);
      assert.match(result.stderr, /ENOTSUP|not supported/);
      assert.deepEqual(await writable.readdir("/work"), []);
      return;
    }
    assert.equal(publications, 1, result.stderr);
    assert.equal(result.exitCode, replaceAncestor ? 2 : 0, result.stderr);
    if (replaceAncestor) {
      await assert.rejects(writable.lstat("/work/sub/file"), { code: "ENOENT" });
      assert.deepEqual(await writable.readdir("/work/old"), []);
    } else {
      assert.deepEqual(await writable.readFile("/work/sub/file"), payload);
      assert.deepEqual((await writable.readdir("/work/sub")).map(entry => entry.name), ["file"]);
    }
    assert.deepEqual(await skills.readFile("/input.tar"), archive);
  });
}
