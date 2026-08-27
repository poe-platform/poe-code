import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const post = JSON.parse(await readFile(join(root, "POST.json")));
assert.equal(post.matchesPre, true);
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.notEqual(entry.name, "AGENTS.md");
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else {
      assert(entry.isFile());
      assert(!/\.(?:ts|mts)$/u.test(entry.name));
      const bytes = await readFile(path);
      files.push({ path: relative(root, path), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
}
await visit(root);
files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const manifest = { reviewer: "V9-Final-Independent-20260827", at: new Date().toISOString(), selfExcluded: "EVIDENCE_MANIFEST.json", regularFiles: files.length, files };
await writeFile(join(root, "EVIDENCE_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`Sealed ${files.length} evidence files; POST matches PRE; no loose TypeScript or AGENTS files.\n`);
