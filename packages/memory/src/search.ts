import * as fs from "node:fs/promises";
import path from "node:path";
import { collectMarkdownRelPaths } from "./pages.js";
import { assertNoSymlinkSegments, MEMORY_PAGES_DIR_RELPATH } from "./paths.js";
import type { MemoryRoot, SearchHit } from "./types.js";

export async function searchMemory(root: MemoryRoot, query: string): Promise<SearchHit[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error("Search query cannot be empty.");
  }

  const relPaths = await collectMarkdownRelPaths(root, MEMORY_PAGES_DIR_RELPATH);
  const hits: SearchHit[] = [];

  for (const relPath of relPaths) {
    await assertNoSymlinkSegments(root, relPath);
    const content = await fs.readFile(path.join(root, relPath), "utf8");
    if (content.length === 0) {
      continue;
    }

    const lines = content.replaceAll("\r\n", "\n").split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.includes(normalizedQuery)) {
        continue;
      }

      hits.push({
        relPath,
        lineNumber: index + 1,
        line
      });
    }
  }

  return hits;
}
