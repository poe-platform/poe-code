import * as fs from "node:fs/promises";
import path from "node:path";
import { hasOwnErrorCode } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import { assertNoSymlinkSegments, assertSafeRelPath } from "./paths.js";
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
  const normalizedRelPath = assertSafeRelPath(relPath);
  const pagePath = path.join(root, normalizedRelPath);
  const original = await readIfPresent(pagePath);
  const tempRoot = path.join(root, ".tmp");
  await assertNoSymlinkSegments(root, ".tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tempRoot, "poe-code-memory-edit-"));
  const tempPath = path.join(tempDir, path.basename(normalizedRelPath));

  try {
    await fs.writeFile(tempPath, original ?? "", "utf8");
    await opts.launchEditor(tempPath);
    const edited = await fs.readFile(tempPath, "utf8");

    if (edited === (original ?? "")) {
      return { changed: false };
    }

    const parsed = parseFrontmatter(edited);
    const diff = await writePage(root, normalizedRelPath, parsed.body, {
      frontmatter: parsed.frontmatter as PageFrontmatter,
      reason: opts.reason
    });

    return {
      changed: true,
      diff
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}
