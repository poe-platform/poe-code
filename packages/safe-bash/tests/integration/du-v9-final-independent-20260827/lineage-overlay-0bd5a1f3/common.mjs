import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const owned = dirname(fileURLToPath(import.meta.url));
export const repository = "/Users/kjopek/Workspace/safe-bash";
export const freeze = "1b2ddea9e38b25cc91134a2f35a318e27f4d7c29";
export const candidate = "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d";
export const overlayCommit = "0bd5a1f3c31ef5e6203a82026181fa0fc73acc79";
export const frozenPath = "tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92";
export const overlayPath = "tests/integration/du-overlay-independent-20260827/v9-lineage-overlay-20260827";
export const manifestSha = "474a95bd160636cdbabe03943a0a84aaaeb56d04ab87d25915bb1ac8cbdf9fa2";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const save = (name, value) => writeFile(join(owned, name), Buffer.isBuffer(value) || typeof value === "string" ? value : json(value), { flag: "wx" });
export const git = args => execFileSync("/usr/bin/git", args, { cwd: repository, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
export const gitBytes = (revision, path) => git(["show", `${revision}:${path}`]);
export const record = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes), gitBlob: blob(bytes) });
export const sort = records => [...records].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));

export async function inventory(root, links = false) {
  const records = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) records.push(record(relative(root, path), await readFile(path)));
      else {
        assert(links && entry.isSymbolicLink(), `nonregular inventory entry: ${path}`);
        const target = await realpath(path);
        assert(target.startsWith(`${root}/`), `tool link escapes package: ${path}`);
        records.push({ path: relative(root, path), link: await readlink(path), target: relative(root, target), targetSha256: hash(await readFile(target)) });
      }
    }
  }
  await visit(root);
  return sort(records);
}

export async function committedTree(revision, root, checkComplete = true) {
  assert.equal(git(["rev-parse", `${revision}^{commit}`]).toString().trim(), revision);
  const paths = git(["ls-tree", "-r", "--name-only", revision, "--", root]).toString().trim().split("\n");
  const records = [];
  for (const path of paths) {
    assert(!/(^|\/)AGENTS\.md$/u.test(path));
    const expected = record(path.slice(root.length + 1), gitBytes(revision, path));
    assert.deepEqual(record(expected.path, await readFile(join(repository, path))), expected);
    records.push(expected);
  }
  if (checkComplete) assert.deepEqual(await inventory(join(repository, root)), records);
  return { commit: revision, root, tree: git(["rev-parse", `${revision}:${root}`]).toString().trim(), records };
}

export async function toolsSnapshot() {
  const previous = JSON.parse(await readFile(join(owned, "../PRE.json")));
  const executables = {};
  for (const [name, value] of Object.entries(previous.tools)) {
    const path = await realpath(value.requested);
    executables[name] = { requested: value.requested, path, sha256: hash(await readFile(path)) };
  }
  assert.equal(executables.node.path, await realpath(process.execPath));
  const packages = {};
  for (const [name, value] of Object.entries(previous.toolPackages)) {
    const records = await inventory(value.path, true);
    packages[name] = { path: value.path, records, inventorySha256: hash(Buffer.from(json(records))), version: JSON.parse(await readFile(join(value.path, "package.json"))).version };
  }
  const oracle = JSON.parse(await readFile(join(repository, frozenPath, "config/oracle-identity.json")));
  assert.equal(await realpath(oracle.requestedPath), oracle.realpath);
  assert.equal(hash(await readFile(oracle.realpath)), oracle.sha256);
  return { executables, packages, oracle };
}

export function identifiers(base, product) {
  assert.equal(base, freeze, "wrong base revision");
  assert.equal(product, candidate, "wrong candidate revision");
}

export function exactBytes(bytes, expected, label) {
  assert.deepEqual(record(expected.path, bytes), expected, `${label} bytes do not match authenticated identity`);
}
