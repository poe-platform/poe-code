import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
const hash = data => createHash("sha256").update(data).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
const paths = [
  "tests/fs/mount/copy-identity-guards.test.ts", "tests/fs/mount/copy-identity.test.ts",
  "tests/fs/overlay/copy-identity.test.ts", "tests/fs/real/copy-identity.test.ts",
  "tests/fs/mount/evidence/identity-compatibility-proposal-4fa",
  "tests/fs/mount/identity-compatibility-review/evidence/pinned-final",
  "tests/fs/mount/identity-compatibility-review/evidence/worktree-final",
  "tests/fs/mount/evidence/identity-fixed-20260826",
];
const baseline = "d799cbb";
const manifest = { capturedAt: new Date().toISOString(), head: git("rev-parse", "HEAD").toString().trim(), baseline, unchangedHistoricalFiles: {}, activeReviewerFiles: {}, artifacts: {} };
manifest.tooling = {
  node: process.version,
  typescript: JSON.parse(await readFile(join(repository, "node_modules/typescript/package.json"), "utf8")).version,
  tsx: JSON.parse(await readFile(join(repository, "node_modules/tsx/package.json"), "utf8")).version,
  packageLockHash: hash(await readFile(join(repository, "package-lock.json"))),
};
for (const file of git("ls-tree", "-r", "--name-only", "-z", baseline, "--", ...paths).toString().split("\0").filter(Boolean)) {
  const data = await readFile(join(repository, file));
  assert.equal(hash(data), hash(git("show", `${baseline}:${file}`)), `historical evidence changed: ${file}`);
  manifest.unchangedHistoricalFiles[file] = hash(data);
}
for (const name of ["run.mjs", "REPORT.md", "compatibility.test.ts"]) {
  const file = `tests/fs/mount/identity-compatibility-review/${name}`;
  const original = hash(git("show", `${baseline}:${file}`));
  const current = hash(await readFile(join(repository, file)));
  manifest.activeReviewerFiles[file] = { original, current, changed: original !== current };
}
for (const entry of await readdir(join(owned, "evidence"), { withFileTypes: true, recursive: true })) {
  if (!entry.isFile()) continue;
  const file = join(entry.parentPath, entry.name);
  if (relative(owned, file) === "evidence/integrity.json") continue;
  manifest.artifacts[relative(owned, file)] = hash(await readFile(file));
}
await writeFile(join(owned, "evidence/integrity.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ historicalFilesUnchanged: Object.keys(manifest.unchangedHistoricalFiles).length, artifacts: Object.keys(manifest.artifacts).length }));
