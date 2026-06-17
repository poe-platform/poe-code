import { describe, expect, it } from "vitest";
import { memLintFs, pkgJson } from "./fixtures.js";
import { scanRuntimeFileAssets } from "./runtime-files.js";

const packages = [{ name: "agent", dir: "packages/agent" }];

async function scan(files: Record<string, string>) {
  return scanRuntimeFileAssets(memLintFs(files), "/repo", packages);
}

describe("scanRuntimeFileAssets", () => {
  it("detects fileURLToPath dirname joins", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/index.ts": `
        import { readFileSync } from "node:fs";
        import { join, dirname } from "node:path";
        import { fileURLToPath } from "node:url";
        const here = dirname(fileURLToPath(import.meta.url));
        readFileSync(join(here, "templates", "x.md"), "utf8");
      `
    });

    expect(view.get("packages/agent")).toMatchObject([
      {
        sourceFile: "packages/agent/src/index.ts",
        sourceRelPath: "src/templates/x.md",
        runtimeRelPath: "dist/templates/x.md",
        kind: "file"
      }
    ]);
  });

  it("detects new URL assets relative to import.meta.url", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/prompts.ts": `
        import { readFile } from "node:fs/promises";
        await readFile(new URL("./SYSTEM_PROMPT.md", import.meta.url), "utf8");
      `
    });

    expect(view.get("packages/agent")).toMatchObject([
      {
        sourceRelPath: "src/SYSTEM_PROMPT.md",
        runtimeRelPath: "dist/SYSTEM_PROMPT.md",
        kind: "file"
      }
    ]);
  });

  it("detects finite literal array path sets", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/templates.ts": `
        import { readFileSync } from "node:fs";
        import path from "node:path";
        const TEMPLATE_IDS = ["a.md", "b.md"] as const;
        const base = path.join(import.meta.dirname, "templates");
        for (const templateId of TEMPLATE_IDS) {
          readFileSync(path.join(base, templateId), "utf8");
        }
      `
    });

    expect(
      view
        .get("packages/agent")
        ?.map((ref) => ref.runtimeRelPath)
        .sort()
    ).toEqual(["dist/templates/a.md", "dist/templates/b.md"]);
  });

  it("detects directory assets from readdirSync", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/corpus.ts": `
        import { readdirSync } from "node:fs";
        import { join } from "node:path";
        const corpusDirectoryPath = join(import.meta.dirname, "corpus");
        readdirSync(corpusDirectoryPath);
      `
    });

    expect(view.get("packages/agent")).toMatchObject([
      {
        sourceRelPath: "src/corpus",
        runtimeRelPath: "dist/corpus",
        kind: "directory"
      }
    ]);
  });

  it("ignores dynamic user paths", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/index.ts": `
        import { readFile } from "node:fs/promises";
        import path from "node:path";
        export async function load(options: { path: string }, cwd: string, filePath: string) {
          await readFile(options.path, "utf8");
          await readFile(path.resolve(cwd, filePath), "utf8");
        }
      `
    });

    expect(view.get("packages/agent")).toEqual([]);
  });

  it("records cross-package asset paths for collocation checks", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/index.ts": `
        import { readFileSync } from "node:fs";
        import { join } from "node:path";
        readFileSync(join(import.meta.dirname, "..", "..", "other", "src", "templates", "x.md"), "utf8");
      `
    });

    const [ref] = view.get("packages/agent") ?? [];
    expect(ref).toMatchObject({
      runtimeRelPath: "packages/other/src/templates/x.md",
      externalPackageRelPath: "packages/other/src/templates/x.md"
    });
    expect(ref).not.toHaveProperty("sourceRelPath");
  });

  it("records the finite source expression for reports", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/index.ts": `
        import * as fs from "node:fs";
        fs.readFileSync(new URL("./templates/x.md", import.meta.url), "utf8");
      `
    });

    expect(view.get("packages/agent")?.[0]?.expression).toBe(
      'new URL("./templates/x.md", import.meta.url)'
    );
  });

  it("detects fs.promises namespace reads and copy sources", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/index.ts": `
        import fs from "node:fs";
        import { cp } from "node:fs/promises";
        await fs.promises.readFile(new URL("./prompts/a.md", import.meta.url), "utf8");
        await cp(new URL("./templates", import.meta.url), "/tmp/templates", { recursive: true });
      `
    });

    expect(view.get("packages/agent")?.map((ref) => [ref.kind, ref.runtimeRelPath])).toEqual([
      ["file", "dist/prompts/a.md"],
      ["directory", "dist/templates"]
    ]);
  });

  it("detects file copy sources as runtime assets", async () => {
    const view = await scan({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent" }),
      "/repo/packages/agent/src/index.ts": `
        import { copyFile } from "node:fs/promises";
        import fs from "node:fs";
        await copyFile(new URL("./templates/a.md", import.meta.url), "/tmp/a.md");
        fs.copyFileSync(new URL("./templates/b.md", import.meta.url), "/tmp/b.md");
      `
    });

    expect(view.get("packages/agent")?.map((ref) => [ref.kind, ref.runtimeRelPath])).toEqual([
      ["file", "dist/templates/a.md"],
      ["file", "dist/templates/b.md"]
    ]);
  });
});
