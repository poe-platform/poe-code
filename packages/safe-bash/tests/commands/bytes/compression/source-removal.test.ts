import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { run, wrap } from "./helpers.js";
import { Shell } from "../../../../src/shell/shell.js";
import { CommandRegistry } from "../../../../src/contracts/index.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";

for (const race of ["ancestor", "replacement", "revision"] as const) {
  test(`gzip: conditional source removal preserves ${race} changes`, async () => {
    const memory = createMemoryFileSystem();
    await memory.mkdir("/work/sub", { recursive: true });
    await memory.mkdir("/private");
    await memory.writeFile("/work/sub/a", Buffer.from("ordinary"));
    await memory.writeFile("/private/a", Buffer.from("topsecret"));
    let reached = false;
    const mutate = async () => {
      reached = true;
      if (race === "ancestor") {
        await memory.rename("/work/sub", "/work/held");
        await memory.symlink("/private", "/work/sub");
      } else {
        if (race === "replacement") await memory.rename("/work/sub/a", "/work/sub/held");
        await memory.writeFile("/work/sub/a", Buffer.from("changed"));
      }
    };
    const fs = wrap(memory, {
      async rm(path, options) {
        if (path === "/work/sub/a") await mutate();
        await memory.rm(path, options);
      },
      async removeFileConditional(path, options) {
        await mutate();
        await memory.removeFileConditional!(path, options);
      },
    });
    const shell = new Shell({ fs, cwd: "/work", commands: new CommandRegistry(createCompressionCommands()) });
    const result = await shell.exec("gzip sub/a");
    await shell.dispose();
    assert.equal(reached, true, "source removal must be reached");
    assert.notEqual(result.exitCode, 0, "changed source cleanup must fail");
    assert.equal(Buffer.from(await memory.readFile("/private/a")).toString(), "topsecret");
    const parent = race === "ancestor" ? "/work/held" : "/work/sub";
    assert.equal(gunzipSync(await memory.readFile(parent + "/a.gz")).toString(), "ordinary");
    assert.equal(Buffer.from(await memory.readFile(parent + "/a")).toString(), race === "ancestor" ? "ordinary" : "changed");
  });
}

for (const missing of ["method", "capability"] as const) {
  test(`gzip: refuses automatic source removal without atomic ${missing}`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", Buffer.from("ordinary"));
    const capabilities = { ...memory.capabilities, atomicFileMutation: missing !== "capability" };
    const wrapped = wrap(memory, {
      capabilities,
      async capabilitiesFor() { return capabilities; },
    });
    const fs = new Proxy(wrapped, {
      get(target, property) {
        if (missing === "method" && property === "removeFileConditional") return undefined;
        return Reflect.get(target, property);
      },
    });
    const result = await run("gzip", ["input"], undefined, { fs });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /atomic.*source removal/);
    assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
    const kept = await run("gzip", ["-k", "input"], undefined, { fs });
    assert.equal(kept.exitCode, 0, kept.stderr);
  });
}

test("gzip: refuses unidentified source before publishing output", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("ordinary"));
  const fs = wrap(memory, {
    async lstat(path, options) {
      const stat = await memory.lstat(path, options);
      if (path !== "/input") return stat;
      const { identityScope: ignoredScope, ...unidentified } = stat;
      return unidentified;
    },
  });
  const result = await run("gzip", ["input"], undefined, { fs });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /stable scoped.*identities/);
  assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
});

for (const missing of ["revision", "parent identity"] as const) {
  test(`gzip: refuses missing ${missing} before publication and supports keep`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", Buffer.from("ordinary"));
    const fs = wrap(memory, {
      async lstat(path, options) {
        const stat = await memory.lstat(path, options);
        if (missing === "revision" && path === "/input") {
          const { revision: ignoredRevision, ...unversioned } = stat;
          return unversioned;
        }
        if (missing === "parent identity" && path === "/") {
          const { identityScope: ignoredScope, ...unidentified } = stat;
          return unidentified;
        }
        return stat;
      },
    });
    const refused = await run("gzip", ["input"], undefined, { fs });
    assert.notEqual(refused.exitCode, 0);
    assert.match(refused.stderr, /parent identity and source revision/);
    assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
    const kept = await run("gzip", ["-k", "input"], undefined, { fs });
    assert.equal(kept.exitCode, 0, kept.stderr);
    assert.equal(gunzipSync(await memory.readFile("/input.gz")).toString(), "ordinary");
    assert.equal(Buffer.from(await memory.readFile("/input")).toString(), "ordinary");
  });
}
