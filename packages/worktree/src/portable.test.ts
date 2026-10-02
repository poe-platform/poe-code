import { build } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function loadPortableRuntime() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["workerd"],
    format: "iife",
    globalName: "runtime",
    logLevel: "silent",
    alias: {
      "@poe-code/safe-fs/contracts": fileURLToPath(new URL("../../safe-fs/src/contracts/index.ts", import.meta.url)),
      "@poe-code/user-error": fileURLToPath(new URL("../../user-error/src/index.ts", import.meta.url))
    }
  });
  return runInNewContext(`${result.outputFiles[0].text}; runtime`, {
    crypto: globalThis.crypto,
    Error,
    TextEncoder,
    TextDecoder,
    setTimeout
  });
}

describe("portable worktree registry", () => {
  it("updates a registry without Node globals or built-ins", async () => {
    const runtime = await loadPortableRuntime();
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;
    const worktree = {
      name: "test", path: "/worktrees/test", branch: "test", baseBranch: "main",
      createdAt: new Date(0).toISOString(), source: "test", agent: "test", status: "active"
    };
    await fs.writeFile("/registry.yaml", JSON.stringify({ worktrees: [worktree] }));
    await runtime.updateWorktreeEntry("/registry.yaml", "test", (entry: typeof worktree) => entry, { fs });
    expect(await runtime.readRegistry("/registry.yaml", fs)).toEqual({ worktrees: [worktree] });
    expect(Object.keys(volume.toJSON())).toEqual(["/registry.yaml"]);
  });
});
