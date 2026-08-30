import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const mode = process.argv[2];
const root = await realpath(resolve(process.argv[3] ?? ""));
if (!new Set(["--write", "--verify"]).has(mode) || !process.argv[3]) {
  throw new Error("usage: node verify-evidence.mjs --write|--verify EVIDENCE_ROOT");
}

const manifestPath = join(root, "EVIDENCE_MANIFEST.json");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const files = [];
const directories = [];
const visit = async absolute => {
  const entries = await readdir(absolute, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const absolutePath = join(absolute, entry.name);
    const path = relative(root, absolutePath).replaceAll("\\", "/");
    if (path === "EVIDENCE_MANIFEST.json") continue;
    if (entry.isDirectory()) {
      directories.push(path);
      await visit(absolutePath);
    } else if (entry.isFile()) {
      const bytes = await readFile(absolutePath);
      files.push({
        path,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        mode: (await lstat(absolutePath)).mode & 0o7777,
      });
    } else {
      throw new Error(`unsupported evidence entry: ${path}`);
    }
  }
};
await visit(root);
const forbiddenAgents = [...directories, ...files.map(file => file.path)]
  .filter(path => /(^|\/)AGENTS\.md$/u.test(path));
if (forbiddenAgents.length) throw new Error(`forbidden evidence path: ${forbiddenAgents.join(", ")}`);
const document = {
  schema: 1,
  candidateCommit: "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d",
  freezeCommit: "a08227b95b5ac3fc9175df6ca90a7700e5bdcbf4",
  preReplayAuditCommit: "d6814492",
  selfExcluded: true,
  pathOrder: "ASCII bytewise",
  fileCount: files.length,
  directoryCount: directories.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  forbiddenAgents,
  directories,
  files,
};
const encoded = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);

if (mode === "--write") {
  await writeFile(manifestPath, encoded, { flag: "wx" });
} else {
  const committed = await readFile(manifestPath);
  if (!committed.equals(encoded)) throw new Error("evidence manifest does not match the complete current evidence tree");
}
process.stdout.write(`${JSON.stringify({
  mode,
  root,
  fileCount: document.fileCount,
  directoryCount: document.directoryCount,
  totalBytes: document.totalBytes,
  manifestSha256: mode === "--write" ? sha256(encoded) : sha256(await readFile(manifestPath)),
  completeInventoryVerified: true,
  forbiddenAgents: 0,
}, null, 2)}\n`);
