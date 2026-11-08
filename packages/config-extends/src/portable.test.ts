import { build } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function loadPortableRuntime(entry = "./index.ts") {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["workerd"],
    format: "iife",
    globalName: "runtime",
    logLevel: "silent",
    alias: {
      "@poe-code/safe-fs/contracts": fileURLToPath(new URL("../../safe-fs/src/contracts/index.ts", import.meta.url)),
      "toolcraft-design/components/template": fileURLToPath(new URL("../../toolcraft-design/src/components/template.ts", import.meta.url)),
      "@poe-code/frontmatter": fileURLToPath(new URL("../../frontmatter/src/index.ts", import.meta.url)),
      "@poe-code/safe-fs/node": fileURLToPath(new URL("../../safe-fs/src/node/index.ts", import.meta.url)),
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

describe("portable prompt documents", () => {
  it("resolves inherited UTF-8 prompts through a byte filesystem", async () => {
    const runtime = await loadPortableRuntime();
    const volume = Volume.fromJSON({
      "/workspace/review.md": "---\nextends: ./base.md\n---\nReview {{name}}. {{yield}}",
      "/workspace/base.md": "Include café."
    });
    const mem = createFsFromVolume(volume).promises;
    const fs = {
      capabilities: { read: true, realpath: true },
      readFile: async (path: string) => new Uint8Array(await mem.readFile(path)),
      realpath: async (path: string) => mem.realpath(path)
    };
    const result = await runtime.resolvePromptDocument({
      cwd: "/workspace", filePath: "review.md", variables: { name: "π" }, fs
    });
    expect(result.prompt).toBe("Review π. Include café.");
  });
});
