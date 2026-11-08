import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

export const own = path.dirname(fileURLToPath(import.meta.url));
export const frozen = path.dirname(own);
export const repo = path.resolve(frozen, "../../../..");
export const revision = "review-ca1d3342";
export const commits = {
  baseline: "5137a74ec855a32d8a8860eb66b62eb44d11e290",
  candidate: "ca1d33424b94a21ae0f40a36412fd8191611e2df",
  evidence: "899de9ab1344179bde928076217c45ba80c345c8",
  freeze: "c65c121e0756390869cddcf78ceb49d0de9cdd2b",
};
export const overrides = {
  "src/fs/webdav/webdav.ts": "cf65b82429bd92ca52b73490e1d6c1070545b5912fbddaba7037e01c57cc21f5",
  "src/fs/webdav/README.md": "b931ac0545c709d3be2bd7d8e328fe9b1137cdb6514dfd8e9975c64c1fecb7bd",
};
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const objectHash = (type, bytes) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
export const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
export const write = (filename, bytes) => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes, { flag: "wx" }); };
export const save = (filename, value) => write(path.join(own, filename), JSON.stringify(value, null, 2) + "\n");
export const pack = value => gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
export const unpack = filename => JSON.parse(gunzipSync(fs.readFileSync(filename)));
export function treeBlob(root, filename, proof) {
  let current = root;
  for (const segment of filename.split("/")) {
    const bytes = Buffer.from(proof[current], "base64");
    assert.equal(objectHash("tree", bytes), current);
    let offset = 0;
    let found;
    while (offset < bytes.length) {
      const end = bytes.indexOf(0, offset);
      const label = bytes.subarray(offset, end).toString().split(" ");
      if (label[1] === segment) found = bytes.subarray(end + 1, end + 21).toString("hex");
      offset = end + 21;
    }
    assert.ok(found, `tree member missing: ${filename}`);
    current = found;
  }
  return current;
}
export function inventory(root, followToolLinks = false) {
  const result = {};
  const visit = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert.ok(followToolLinks || !entry.isSymbolicLink(), `symlink refused: ${filename}`);
      if (entry.isSymbolicLink()) assert.ok(fs.realpathSync(filename).startsWith(`${fs.realpathSync(root)}/`), "tool symlink escapes pinned tool root");
      if (fs.statSync(filename).isDirectory()) visit(filename, name);
      else {
        assert.ok(fs.statSync(filename).isFile(), `nonregular file: ${filename}`);
        const bytes = fs.readFileSync(filename);
        result[name] = { sha256: hash(bytes), bytes: bytes.length, mode: fs.statSync(filename).mode & 0o777 };
      }
    }
  };
  visit(root, "");
  return result;
}
export function originalFreeze() {
  const prefix = path.relative(repo, frozen);
  const archive = fs.existsSync(path.join(own, "FROZEN-INPUTS.json.gz")) ? unpack(path.join(own, "FROZEN-INPUTS.json.gz")) : undefined;
  if (archive) assert.equal(objectHash("commit", Buffer.from(archive.commit.base64, "base64")), commits.freeze);
  const original = archive ? JSON.parse(Buffer.from(archive.files["MANIFEST.json"].base64, "base64")) : JSON.parse(git("show", `${commits.freeze}:${prefix}/MANIFEST.json`));
  const names = fs.readdirSync(frozen).filter(name => name !== revision).sort();
  assert.deepEqual(names, original.allowedMembers, "unknown addition outside the one authorized review subtree");
  const result = {};
  for (const name of names) {
    assert.ok(fs.lstatSync(path.join(frozen, name)).isFile());
    const bytes = archive ? Buffer.from(archive.files[name].base64, "base64") : git("show", `${commits.freeze}:${prefix}/${name}`);
    if (archive) assert.equal(objectHash("blob", bytes), treeBlob(archive.commit.tree, `${prefix}/${name}`, archive.treeProof));
    result[name] = hash(bytes);
    assert.equal(hash(fs.readFileSync(path.join(frozen, name))), result[name], `original freeze altered: ${name}`);
  }
  return result;
}
export function liveProtected() {
  const paths = ["src/fs/webdav", "src/fs/readonly", "src/shell", "src/contracts", "src/index.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"];
  const result = {};
  for (const name of paths) {
    const filename = path.join(repo, name);
    if (fs.statSync(filename).isDirectory()) for (const [child, record] of Object.entries(inventory(filename))) result[`${name}/${child}`] = record;
    else result[name] = { sha256: hash(fs.readFileSync(filename)), bytes: fs.statSync(filename).size, mode: fs.statSync(filename).mode & 0o777 };
  }
  return result;
}
export function restore(files, root) {
  for (const [name, record] of Object.entries(files)) {
    assert.ok(!path.isAbsolute(name) && !name.split("/").includes(".."));
    const bytes = Buffer.from(record.base64, "base64");
    assert.equal(hash(bytes), record.sha256);
    const filename = path.join(root, name);
    write(filename, bytes);
    fs.chmodSync(filename, record.mode);
  }
}
