import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [candidate, output, baseline] = process.argv.slice(2);
assert(candidate && output);
const repository = "/Users/kjopek/Workspace/safe-bash";
const commit = "a809635432f18a235b8fb622a05367bedc54b315";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitRows = execFileSync("git", ["ls-tree", "-rz", "--full-tree", commit], { cwd: repository, maxBuffer: 67108864 }).toString().split("\0").filter(Boolean);
const trackedLinks = new Set(gitRows.filter((row) => row.startsWith("120000 ")).map((row) => row.slice(row.indexOf("\t") + 1)));
const entries = [];
async function visit(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const absolute = join(directory, name), path = relative(candidate, absolute), stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      if (path.startsWith("node_modules/")) assert((await realpath(absolute)).startsWith(`${repository}/node_modules/`));
      else assert(trackedLinks.has(path) && path.startsWith("tests/"), `No source/module alias: ${path}`);
      entries.push({ path, link: await readlink(absolute) });
    } else if (stat.isDirectory()) await visit(absolute);
    else { assert(stat.isFile()); entries.push({ path, bytes: stat.size, sha256: hash(await readFile(absolute)) }); }
  }
}
await visit(candidate);
entries.sort((left, right) => left.path.localeCompare(right.path));
const sourcePaths = ["column", "display", "index", "internal", "options", "table"].map((name) => `src/commands/column/${name}.ts`);
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, hash(await readFile(join(candidate, path)))])));
assert.equal(hash(JSON.stringify(sourceHashes)), "e4f9a8d1690600807d496ae8bc42409cc98344ee7bba10ea702a136d52cd370e");
for (const row of gitRows) {
  const separator = row.indexOf("\t"), [mode, type, blob] = row.slice(0, separator).split(" "), path = row.slice(separator + 1);
  assert.equal(type, "blob");
  const bytes = mode === "120000" ? Buffer.from(await readlink(join(candidate, path))) : await readFile(join(candidate, path));
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), blob, path);
}
const prep = JSON.parse(await readFile(join(candidate, "tests/commands/column-stress/padding-evolution/seal.json")));
for (const file of prep.files) assert.equal(hash(await readFile(join(repository, "tests/commands/column-stress/padding-evolution", file.path))), file.sha256);
assert.equal(hash(await readFile(join(repository, "tests/commands/column-stress/padding-evolution/seal.json"))), "93894eafdc02cc8bdee171f1301cbdf21a74b0c448697edffd3573de6f28ae8c");
if (baseline) assert.deepEqual(entries, JSON.parse(await readFile(baseline)).entries, "Changed, removed or added archive entry after runtime");
const record = { commit, sourceTree: "8b32998383d1372a8624ac41d2e747551e5b6d4c", candidate: await realpath(candidate), at: new Date().toISOString(), sourceHashes, sourceDigest: hash(JSON.stringify(sourceHashes)), originalGitBlobsVerified: gitRows.length, entryCount: entries.length, inventorySha256: hash(JSON.stringify(entries)), detectsAdditions: true, comparedTo: baseline ?? null, entries };
await writeFile(output, JSON.stringify(record) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, sourceDigest: record.sourceDigest, originalGitBlobsVerified: gitRows.length, entryCount: entries.length, inventorySha256: record.inventorySha256, detectsAdditions: true }));
