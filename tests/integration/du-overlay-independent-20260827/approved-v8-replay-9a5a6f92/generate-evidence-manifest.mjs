import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const evidenceBaseCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/u.test(evidenceBaseCommit ?? "")) {
  throw new Error("usage: node generate-evidence-manifest.mjs EXACT_EVIDENCE_BASE_COMMIT");
}
const output = join(root, "EVIDENCE_MANIFEST.json");
try {
  await lstat(output);
  throw new Error("EVIDENCE_MANIFEST.json already exists");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
const files = [];
const visit = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const local = relative(root, path).replaceAll("\\", "/");
    if (local === "EVIDENCE_MANIFEST.json") continue;
    if (/(^|\/)AGENTS\.md$/u.test(local)) throw new Error(`forbidden evidence path: ${local}`);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      files.push({
        path: local,
        bytes: bytes.byteLength,
        mode: (await lstat(path)).mode & 0o7777,
        sha256: sha256(bytes),
        gitBlob: gitBlob(bytes),
      });
    } else throw new Error(`unsupported evidence entry: ${local}`);
  }
};
await visit(root);
files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const document = {
  schema: 1,
  selfExcluded: true,
  pathOrder: "ASCII bytewise",
  generatedAt: new Date().toISOString(),
  candidateCommit: "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d",
  freezeCommit: "ae0f8b3f4f927b06718fc51e176ca7a54b517364",
  freezeTree: "bf0d08a7a5640a1cb8aa0d1871d0b68d89cfc170",
  freezeFixtureTree: "8c845070afd27a3be5038b50d222f36dd9178838",
  freezeManifestSha256: "e8f957bd9ea434b0af5388ab0e2ed2d936d5338fcbca5344f3793b08e5e38af7",
  preReplayAuditCommit: "2477d20c385adf55e3f737eb1dada4e1f9139931",
  evidenceBaseCommit,
  decision: "V8_REPLAY_REJECTED_AS_FROZEN_FIXTURE_ATIME_PRECONDITION_FAILURE",
  run: { relativePath: "replay-001/run-2026-08-27T203020598Z-9c8b02" },
  files,
};
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({
  output,
  selfExcluded: true,
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
}, null, 2)}\n`);
