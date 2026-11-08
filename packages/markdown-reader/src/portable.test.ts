import { build } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("reads Unicode sections from byte filesystems without Node built-ins or Buffer", async () => {
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const bundle = await build({
    entryPoints: [source("./core/read-section.ts")],
    bundle: true, write: false, platform: "browser", conditions: ["workerd"],
    format: "iife", globalName: "runtime", logLevel: "silent",
    alias: {
      "#markdown-reader-filesystem": source("./default-filesystem.workerd.ts"),
      "@poe-code/safe-fs/contracts": source("../../safe-fs/src/contracts/index.ts"),
      "@poe-code/frontmatter": source("../../frontmatter/src/index.ts"),
      "toolcraft-design": source("../../toolcraft-design/src/index.ts"),
      "toolcraft-design/terminal-markdown/parser": source("../../toolcraft-design/src/terminal-markdown/parser.ts"),
      "toolcraft/user-error": source("../../toolcraft/src/user-error.ts"),
      "toolcraft": source("../../toolcraft/src/index.ts")
    }
  });
  const runtime = runInNewContext(`${bundle.outputFiles[0].text}; runtime`, { Error, TextEncoder, TextDecoder });
  const mem = createFsFromVolume(Volume.fromJSON({
    "/docs/guide.md": "---\ntitle: café\n---\n# Intro\né😀\n\n## 子\nπ\n"
  })).promises;
  const read = runtime.createReadSection({ cwd: "/docs", fs: {
    capabilities: { read: true },
    readFile: async (path: string) => new Uint8Array(await mem.readFile(path))
  } });
  expect(await read({ file: "guide.md", section: "子" })).toMatchObject({ markdown: "## 子\nπ\n" });
  expect(await read({ file: "guide.md", section: "Intro", includeChildren: false })).toMatchObject({ markdown: "# Intro\né😀\n\n" });
});
