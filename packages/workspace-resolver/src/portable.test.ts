import { build } from "esbuild";
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

describe("portable workspace resolution", () => {
  it("creates and cleans isolated checkouts without Node globals or built-ins", async () => {
    const runtime = await loadPortableRuntime();
    const calls: string[][] = [];
    const workspace = await runtime.resolveWorkspace("github://owner/repo", {
      baseDir: "/workspace",
      homeDir: "/home/agent",
      mode: "edit",
      fs: {
        mkdir: async () => undefined,
        stat: async () => ({ isDirectory: () => true }),
        lstat: async () => ({ isSymbolicLink: () => false })
      },
      exec: async (_command: string, args: string[]) => {
        calls.push(args);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });
    expect(workspace.cwd).toContain("/home/agent/.poe-code/workspaces/checkouts/owner-repo/");
    await workspace.cleanup();
    expect(calls.some(args => args[0] === "worktree" && args[1] === "remove")).toBe(true);
  });
});
