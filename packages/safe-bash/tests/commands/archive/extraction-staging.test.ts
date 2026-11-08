import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileSystem } from "@poe-code/safe-fs/core";
import { archive, direct, member, wrapped } from "./helpers.js";

for (const scenario of ["success", "ancestor", "ancestor-symlink", "failure"]) {
  test(`tar confined atomic extraction: ${scenario}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work/sub", { recursive: true });
    await fs.writeFile("/work/input.tar", archive(member("sub/a", Buffer.from("payload"))));
    if (scenario === "failure") await fs.writeFile("/work/sub/a", Buffer.from("original"));
    let stages = 0;
    let cleanups = 0;
    const denied = async (): Promise<never> => { throw new FsError("ENOTSUP", { path: "/work", message: "ordinary mutation denied" }); };
    const view = wrapped(fs, {
      writeFile: denied, writeStream: denied, appendFile: denied, mkdir: denied, chmod: denied, utimes: denied,
      async createStagedFile(...args) {
        stages++;
        const staging = await fs.createStagedFile!(...args);
        return staging.cleanup ? { ...staging, cleanup: { async remove() { cleanups++; await staging.cleanup!.remove(); }, close: staging.cleanup.close.bind(staging.cleanup) } } : staging;
      },
      async publishStagedFile(...args) {
        if (scenario.startsWith("ancestor")) {
          await fs.rename("/work/sub", "/work/old");
          if (scenario === "ancestor-symlink") { await fs.mkdir("/private"); await fs.symlink!("/private", "/work/sub"); }
          else await fs.mkdir("/work/sub");
        }
        if (scenario === "failure") throw new Error("publication failed");
        return fs.publishStagedFile!(...args);
      },
      async removeStagedFile(...args) { cleanups++; return fs.removeStagedFile!(...args); },
    } as Partial<FileSystem>);
    const result = await direct(["xf", "input.tar"], view);
    assert.equal(stages, 1, result.stderr);
    assert.equal(cleanups, 1, result.stderr);
    assert.equal(result.exitCode, scenario === "success" ? 0 : 2, result.stderr);
    if (scenario === "success") assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "payload");
    else if (scenario === "failure") assert.equal(Buffer.from(await fs.readFile("/work/sub/a")).toString(), "original");
    else await assert.rejects(fs.lstat("/work/sub/a"), { code: "ENOENT" });
    const old = scenario.startsWith("ancestor") ? "/work/old" : "/work/sub";
    assert.deepEqual((await fs.readdir(old)).map(entry => entry.name), scenario === "success" || scenario === "failure" ? ["a"] : []);
  });
}

test("tar reads a read-only mount and stages into an external writable destination", async () => {
  const { createMountFileSystem, createReadOnlyFileSystem } = await import("@poe-code/safe-fs/core");
  const input = createMemoryFileSystem();
  await input.writeFile("/input.tar", archive(member("nested/", new Uint8Array(), "5"), member("nested/a", Buffer.from("mounted"))));
  const output = createMemoryFileSystem();
  await output.mkdir("/work");
  const mounted = createMountFileSystem({ root: output, mounts: { "/input": createReadOnlyFileSystem(input) } });
  const deny = async (): Promise<never> => { throw new FsError("ENOTSUP"); };
  const confined = wrapped(mounted, { writeFile: deny, appendFile: deny, writeStream: deny, mkdir: deny, chmod: deny, utimes: deny,
    async confineExtraction() { return confined; },
  });
  const result = await direct(["xf", "/input/input.tar", "-C", "/work"], confined);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await output.readFile("/work/nested/a")).toString(), "mounted");
  assert.deepEqual(Buffer.from(await input.readFile("/input.tar")), archive(member("nested/", new Uint8Array(), "5"), member("nested/a", Buffer.from("mounted"))));
});
