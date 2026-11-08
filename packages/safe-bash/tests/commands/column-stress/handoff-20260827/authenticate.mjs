import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const [repository, candidate, commit, archive, output, action = "before"] = process.argv.slice(2);
assert(repository && candidate && commit && archive && output);
assert(resolve(candidate).startsWith("/tmp/safe-bash-column-") || resolve(candidate).startsWith("/private/tmp/safe-bash-column-"));
const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const identify = (path) => { const bytes = readFileSync(path); return { path, bytes: bytes.length, sha256: hash(bytes) }; };
const tree = execFileSync("git", ["ls-tree", "-rz", "--full-tree", commit], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
const entries = [];
const sourceEntries = [];
for (const row of tree) {
  const separator = row.indexOf("\t");
  const header = row.slice(0, separator);
  const path = row.slice(separator + 1);
  const [mode, type, blob] = header.split(" ");
  assert.equal(type, "blob", "No external Git submodule inputs");
  const full = join(candidate, path);
  const bytes = mode === "120000" ? Buffer.from(readlinkSync(full)) : readFileSync(full);
  const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(actual, blob, `Immutable archive blob mismatch: ${path}`);
  const entry = { path, mode, blob, bytes: bytes.length, sha256: hash(bytes) };
  entries.push(entry);
  if (path.startsWith("src/") || path.startsWith("tests/commands/column/") || path === "package.json" || path === "package-lock.json" || path.startsWith("tsconfig")) sourceEntries.push(entry);
}
const author = JSON.parse(readFileSync(join(candidate, "tests/commands/column/author-verification.json")));
const sourceHashes = Object.fromEntries(Object.keys(author.ownedSourceHashes).map((path) => [path, hash(readFileSync(join(candidate, path)))]));
const sourceDigest = hash(JSON.stringify(sourceHashes));
if (commit === "e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64") {
  assert.deepEqual(sourceHashes, author.ownedSourceHashes);
  assert.equal(sourceDigest, "62fa56a685eb5a4850b6fa782266a2f5d21b8c9335f4f0f030f4f5767e1bfdb2");
}
const lockBytes = readFileSync(join(candidate, "package-lock.json"));
assert.equal(hash(readFileSync(join(repository, "package-lock.json"))), hash(lockBytes), "Locked development dependency input mismatch");
const lock = JSON.parse(lockBytes);
const hidden = JSON.parse(readFileSync(join(repository, "node_modules/.package-lock.json")));
const dependencies = [];
function inventory(directory, root = directory) {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      assert(realpathSync(path).startsWith(realpathSync(join(repository, "node_modules")) + "/"), "Dependency symlink escapes development tools");
      result.push({ path: relative(root, path), link: readlinkSync(path) });
    } else if (stat.isDirectory()) result.push(...inventory(path, root));
    else result.push({ path: relative(root, path), sha256: hash(readFileSync(path)) });
  }
  return result;
}
for (const [path, expected] of Object.entries(lock.packages)) {
  if (!path) continue;
  const full = join(repository, path);
  if (!existsSync(full)) { assert(expected.optional, `Missing locked dependency: ${path}`); continue; }
  assert.equal(lstatSync(full).isSymbolicLink(), false, "Development package cannot alias workspace source");
  const actual = JSON.parse(readFileSync(join(full, "package.json")));
  assert.equal(actual.version, expected.version, path);
  assert.equal(hidden.packages[path]?.integrity, expected.integrity, `Installed lock integrity declaration: ${path}`);
  const files = inventory(full);
  dependencies.push({ path, version: actual.version, resolved: expected.resolved, declaredIntegrity: expected.integrity, inventorySha256: hash(JSON.stringify(files)), files });
  const link = join(candidate, path);
  if (!existsSync(link) && action === "before") { mkdirSync(dirname(link), { recursive: true }); symlinkSync(full, link, "dir"); }
  assert.equal(realpathSync(link), realpathSync(full));
}
const result = {
  classification: "committed-archive-and-readonly-locked-devtools-authentication",
  capturedAt: new Date().toISOString(), action, commit, candidate: realpathSync(candidate),
  archive: identify(archive), verifiedGitBlobs: entries.length, gitInventorySha256: hash(JSON.stringify(entries)), sourceEntries,
  sourceHashes, sourceDigest, packageLock: identify(join(candidate, "package-lock.json")),
  dependencies, dependencyInventorySha256: hash(JSON.stringify(dependencies)),
  dependencyCaveat: "Installed package versions and integrity declarations match the lock; every reused dependency file is hashed before/after. No fresh registry tarball/signature verification or installation was performed. Unlocked sibling packages are not linked into the candidate.",
  node: { version: process.version, executable: identify(process.execPath), platform: process.platform, arch: process.arch },
  compiler: identify(join(candidate, "node_modules/typescript/lib/_tsc.js")),
  noLiveProductAlias: true,
};
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ commit, verifiedGitBlobs: entries.length, sourceDigest, dependencies: dependencies.map(({ path, version }) => ({ path, version })), action }));
