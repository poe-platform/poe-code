import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const privateRoot = "/Users/kjopek/Workspace/poe-code";
const privateGit = (...args) => execFileSync("git", ["--no-replace-objects", "-C", privateRoot, ...args], {
  encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 16 * 1024 * 1024 }).trimEnd();

export function privateState() {
  return { root: privateRoot, head: privateGit("rev-parse", "HEAD"), status: privateGit("status", "--porcelain=v1"),
    indexSha256: sha(readFileSync(resolve(privateRoot, privateGit("rev-parse", "--git-path", "index")))) };
}

export async function prerequisites({ repository, source, temporary, environment, candidate }) {
  const result = { capturedAt: new Date().toISOString(), native: {}, assets: [], safejs: {} };
  const authorityFiles = ["tests/commands/metadata-stress/canonical-env/runner.mjs", "tests/plugins/qualified-current-release/prerequisites.mjs"];
  result.authorities = authorityFiles.map(path => {
    const expected = execFileSync("git", ["--no-replace-objects", "show", `${candidate}:${path}`], { cwd: repository });
    assert.equal(sha(readFileSync(join(repository, path))), sha(expected), `native helper drift: ${path}`);
    return { path, sha256: sha(expected) };
  });
  const canonical = await import(pathToFileURL(join(repository, authorityFiles[0])).href);
  const archives = await import(pathToFileURL(join(repository, authorityFiles[1])).href);
  result.native.metadata = canonical.verifySetup();
  assert.deepEqual(result.native.metadata.issues, [], "mandatory metadata/table native profile unavailable");
  for (const asset of result.native.metadata.assets) {
    if (!asset.path.startsWith(repository + "/")) continue;
    const target = join(source, relative(repository, asset.path)); mkdirSync(dirname(target), { recursive: true });
    copyFileSync(asset.path, target); chmodSync(target, lstatSync(asset.path).mode & 0o777);
    assert.equal(sha(readFileSync(target)), asset.sha256); result.assets.push({ source: asset.path, target, sha256: asset.sha256 });
  }
  result.native.archive = archives.archiveSetup(join(repository, archives.tarRelative), repository);
  assert.deepEqual(result.native.archive.issues, [], "mandatory archive native profile unavailable");
  result.native.archiveOverlay = archives.stageArchiveTar({ root: source, directory: temporary }, result.native.archive);
  result.native.authority = archives.fixtureAuthority({ directory: temporary, root: source }, canonical.oracleDirectory);
  assert.deepEqual(result.native.authority.issues, [], "mandatory native fixture authority profile unavailable");
  const coreutils = dirname(canonical.benchmarkStat), byteRoot = join(temporary, "byte-oracles"); mkdirSync(byteRoot);
  const identities = JSON.parse(readFileSync(join(source, "tests/commands/bytes-stress/gnu-evidence.json"))).identities;
  result.native.bytes = [];
  for (const [name, identity] of Object.entries(identities)) {
    const origin = name === "gzip" ? join(dirname(dirname(coreutils)), "gzip-1.14/gzip") : join(coreutils, name);
    const target = join(byteRoot, name); assert.equal(sha(readFileSync(origin)), identity.sha256, `byte oracle identity: ${name}`);
    copyFileSync(origin, target); chmodSync(target, 0o755);
    const version = spawnSync(target, ["--version"], { env: environment, encoding: "utf8", timeout: 5000 });
    assert.equal(version.status, 0); assert.equal(version.stdout.split("\n")[0], identity.version);
    result.native.bytes.push({ name, origin, target, sha256: identity.sha256, version: version.stdout.split("\n")[0] });
  }
  environment.BYTE_GNU_COREUTILS_DIR = byteRoot; environment.BYTE_GNU_GZIP = join(byteRoot, "gzip");

  result.safejs.before = privateState();
  const engine = join(privateRoot, "packages/safejs"), copied = join(temporary, "safejs-engine");
  const files = [];
  function copy(directory, prefix = "") {
    for (const name of readdirSync(directory).sort()) {
      if (["node_modules", ".git", "dist", ".cache", ".turbo"].includes(name)) continue;
      const origin = join(directory, name), path = join(prefix, name), stat = lstatSync(origin);
      assert.equal(stat.isSymbolicLink(), false, `private engine source link: ${path}`);
      if (stat.isDirectory()) copy(origin, path);
      else {
        assert.ok(stat.isFile()); const bytes = readFileSync(origin), target = join(copied, path);
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); chmodSync(target, stat.mode & 0o777);
        assert.equal(sha(readFileSync(target)), sha(bytes)); files.push({ path, bytes: bytes.length, sha256: sha(bytes), mode: stat.mode & 0o777 });
      }
    }
  }
  copy(engine); result.safejs.files = files; result.safejs.treeSha256 = sha(JSON.stringify(files));
  result.safejs.copiedRoot = copied; result.safejs.package = JSON.parse(readFileSync(join(copied, "package.json")));
  result.safejs.policy = "actual current engine regular-file copy; no private execution, writes, symlinks, build, install, proposal patch or mock runner; availability is not behavioral acceptance";
  assert.deepEqual(privateState(), result.safejs.before, "private state changed during read-only copy");
  environment.SAFEJS_LOCAL_ROOT = copied;
  return result;
}
