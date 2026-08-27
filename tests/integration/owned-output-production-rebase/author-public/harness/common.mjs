import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = "/Users/kjopek/Workspace/safe-bash";
export const owner = "tests/integration/owned-output-production-rebase/author-public";
export const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const git = (...args) => execFileSync("/usr/bin/git", ["-C", repository, "-c", "core.fsmonitor=false", ...args], { env: environment, timeout: 120000, maxBuffer: 512 * 1024 * 1024 });
export const json = filename => JSON.parse(regular(filename));
export function regular(filename) {
  assert.equal(realpathSync(filename), resolve(filename), `No symlink path: ${filename}`);
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  return readFileSync(filename);
}
export function safeRelative(filename) {
  assert.equal(typeof filename, "string");
  assert.ok(filename.length && !filename.startsWith("/") && !filename.includes("\\"));
  assert.ok(filename.split("/").every(part => part && part !== "." && part !== ".."));
  return filename;
}
export function inventory(root, publicTool = false) {
  assert.equal(realpathSync(root), resolve(root));
  assert.ok(lstatSync(root).isDirectory());
  const entries = [];
  function visit(current) {
    for (const name of readdirSync(current).sort()) {
      const filename = join(current, name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) {
        assert.equal(publicTool, true, filename);
        const target = realpathSync(filename);
        assert.ok(target.startsWith(root + "/"), "Public-tool symlink target must stay inside its pinned package");
        const bytes = regular(target);
        entries.push({ path: relative(root, filename), kind: "symlink", target: readlinkSync(filename), mode: lstatSync(target).mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) });
        continue;
      }
      const entry = { path: relative(root, filename), kind: stat.isDirectory() ? "directory" : "file", mode: stat.mode & 0o777 };
      if (stat.isDirectory()) { entries.push(entry); visit(filename); }
      else {
        const bytes = regular(filename);
        entries.push({ ...entry, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}
export function writeNew(filename, bytes, mode = 0o644) {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, bytes, { flag: "wx", mode });
}
export const writeJson = (filename, value) => writeNew(filename, JSON.stringify(value, null, 2) + "\n");
export function verifyEntries(root, expected) {
  assert.deepEqual(inventory(root), expected, `Exact bytes and directory shape: ${root}`);
}
export function copyTree(source, target, expected) {
  verifyEntries(source, expected);
  mkdirSync(target, { recursive: true });
  for (const entry of expected) {
    const filename = join(target, safeRelative(entry.path));
    if (entry.kind === "directory") mkdirSync(filename, { mode: entry.mode });
    else writeNew(filename, regular(join(source, entry.path)), entry.mode);
  }
  verifyEntries(target, expected);
}
export function copyPublicTool(tool, target) {
  assert.deepEqual(inventory(tool.path, true), tool.files);
  mkdirSync(target, { recursive: true });
  for (const entry of tool.files) {
    const filename = join(target, safeRelative(entry.path));
    if (entry.kind === "directory") mkdirSync(filename, { mode: entry.mode });
    else writeNew(filename, regular(realpathSync(join(tool.path, entry.path))), entry.mode);
  }
  const normalized = tool.files.map(entry => {
    if (entry.kind !== "symlink") return entry;
    const { target: linkTarget, ...rest } = entry;
    return { ...rest, kind: "file" };
  });
  verifyEntries(target, normalized);
  return normalized;
}
export function gitEntries(commit, paths) {
  assert.match(commit, /^[a-f0-9]{40}$/u);
  return git("ls-tree", "-rz", commit, "--", ...paths).toString().split("\0").filter(Boolean).map(line => {
    const [header, path] = line.split("\t");
    const [mode, type, blob] = header.split(" ");
    assert.ok(type === "blob" && ["100644", "100755"].includes(mode), `Regular committed input only: ${path}`);
    safeRelative(path);
    return { path, mode, blob };
  });
}
export function gitRecord(commit, path) {
  const entries = gitEntries(commit, [path]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, path);
  const bytes = git("cat-file", "blob", entries[0].blob);
  return { commit, ...entries[0], bytes: bytes.length, sha256: sha256(bytes) };
}
export function verifyReference(reference) {
  assert.deepEqual(gitRecord(reference.commit, reference.path), reference);
  return git("cat-file", "blob", reference.blob);
}
export function verifyAuthor(commit) {
  assert.equal(directory, join(repository, owner), "Authenticated author driver location");
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const frozenBytes = git("show", `${commit}:${owner}/INPUTS.json`);
  assert.deepEqual(regular(join(directory, "INPUTS.json")), frozenBytes);
  const frozen = JSON.parse(frozenBytes);
  for (const entry of frozen.files) {
    const bytes = regular(join(directory, safeRelative(entry.path)));
    assert.equal(sha256(bytes), entry.sha256, entry.path);
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.deepEqual(bytes, git("show", `${commit}:${owner}/${entry.path}`));
  }
  const committed = gitEntries(commit, [owner]).map(entry => entry.path.slice(owner.length + 1)).filter(path => path !== "INPUTS.json").sort();
  assert.deepEqual(committed, frozen.files.map(entry => entry.path).sort());
  return { commit, manifestSha256: sha256(frozenBytes), files: frozen.files };
}
export function verifyRelease(release) {
  assert.equal(release.schema, 1);
  assert.equal(release.phase, "ROOT_RELEASED_AUTHOR_EXECUTION", "No candidate execution during preparation");
  assert.equal(release.qualification, "AUTHOR_ONLY_NOT_INDEPENDENT_ACCEPTANCE");
  assert.equal(release.allowPublicBuildAndConsumer, true);
  assert.ok(typeof release.rootAuthorization === "string" && release.rootAuthorization.trim().length > 0);
  for (const key of ["authorCommit", "candidateCommit", "candidateTree"]) assert.match(release[key], /^[a-f0-9]{40}$/u);
  assert.equal(git("rev-parse", `${release.candidateCommit}^{tree}`).toString().trim(), release.candidateTree);
  return verifyAuthor(release.authorCommit);
}
export function verifyTooling() {
  const pins = json(join(directory, "profiles/TOOLING.json"));
  assert.equal(process.version, pins.node.version);
  assert.equal(sha256(regular(process.execPath)), pins.node.sha256);
  for (const tool of pins.system) assert.equal(sha256(regular(tool.path)), tool.sha256, tool.path);
  const tools = pins.packages.map(tool => {
    const entries = inventory(tool.path, true);
    assert.equal(entries.length, tool.entries, tool.name);
    assert.equal(sha256(JSON.stringify(entries)), tool.inventorySha256, tool.name);
    assert.equal(json(join(tool.path, "package.json")).version, tool.version);
    return { ...tool, files: entries };
  });
  return { node: pins.node, system: pins.system, packages: tools };
}
export function authenticateImport(binding, relativePath, bytes) {
  const entry = binding.files.find(candidate => candidate.path === safeRelative(relativePath));
  assert.ok(entry, `Unknown import refused: ${relativePath}`);
  assert.equal(sha256(bytes), entry.sha256, `Changed import refused: ${relativePath}`);
  return entry;
}
