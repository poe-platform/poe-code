import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("maestro pipeline package independence", () => {
  it("does not import the standalone pipeline package", async () => {
    const srcDir = path.resolve(import.meta.dirname);
    const files = await sourceFiles(srcDir);
    const offenders: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      if (content.includes("loadResolvedSteps") || content.includes("@poe-code/pipeline")) {
        offenders.push(path.relative(srcDir, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(entryPath);
    }
  }

  return files;
}
