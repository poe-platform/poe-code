import * as fs from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { MemoryDiff, MemoryRoot, PageFrontmatter } from "./types.js";
import { writePage } from "./write.js";

export type EditPageOptions = {
  reason: string;
  launchEditor: (filePath: string) => Promise<void>;
};

export type EditPageResult = {
  changed: boolean;
  diff?: MemoryDiff;
};

export async function editPage(
  root: MemoryRoot,
  relPath: string,
  opts: EditPageOptions
): Promise<EditPageResult> {
  const pagePath = path.join(root, relPath);
  const original = await readIfPresent(pagePath);
  const tempRoot = path.join(root, ".tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tempRoot, "poe-code-memory-edit-"));
  const tempPath = path.join(tempDir, path.basename(relPath));

  try {
    await fs.writeFile(tempPath, original ?? "", "utf8");
    await opts.launchEditor(tempPath);
    const edited = await fs.readFile(tempPath, "utf8");

    if (edited === (original ?? "")) {
      return { changed: false };
    }

    const parsed = parseFrontmatter(edited);
    const diff = await writePage(root, relPath, parsed.body, {
      frontmatter: parsed.frontmatter as PageFrontmatter,
      reason: opts.reason
    });

    return {
      changed: true,
      diff
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}
