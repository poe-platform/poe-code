import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { own, frozen, repo, commits, overrides, hash, objectHash, git, save, write, pack, inventory, originalFreeze, liveProtected, restore } from "./common.mjs";

const scratch = path.join(own, "scratch");
assert.ok(!fs.existsSync(scratch));
const rawCommits = {};
for (const [name, commit] of Object.entries(commits)) {
  const bytes = git("cat-file", "commit", commit);
  assert.equal(objectHash("commit", bytes), commit);
  rawCommits[name] = { commit, base64: bytes.toString("base64"), sha256: hash(bytes), tree: bytes.toString().match(/^tree (\w+)$/m)[1] };
}
const freezeHashes = originalFreeze();
const before = liveProtected();
const roots = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md"];
const entries = git("ls-tree", "-r", commits.baseline, "--", ...roots).toString().trim().split("\n");
const files = {};
for (const entry of entries) {
  const [, mode, blob, name] = entry.match(/^(\d+) blob (\w+)\t(.+)$/);
  assert.ok(["100644", "100755"].includes(mode));
  const commit = Object.hasOwn(overrides, name) ? commits.candidate : commits.baseline;
  const bytes = git("show", `${commit}:${name}`);
  const selectedBlob = git("rev-parse", `${commit}:${name}`).toString().trim();
  assert.equal(objectHash("blob", bytes), selectedBlob);
  if (overrides[name]) assert.equal(hash(bytes), overrides[name]);
  else assert.equal(selectedBlob, blob);
  files[name] = { sha256: hash(bytes), mode: Number.parseInt(mode, 8) & 0o777, base64: bytes.toString("base64"), baselineBlob: blob, blob: selectedBlob, commit };
}
const treeProof = {};
function treeAt(tree, prefix = "") {
  const bytes = git("cat-file", "tree", tree);
  assert.equal(objectHash("tree", bytes), tree);
  treeProof[tree] = bytes.toString("base64");
  let offset = 0;
  const rewritten = [];
  while (offset < bytes.length) {
    const end = bytes.indexOf(0, offset);
    const label = bytes.subarray(offset, end).toString();
    const [mode, name] = label.split(" ");
    const identifier = bytes.subarray(end + 1, end + 21).toString("hex");
    const namePath = prefix ? `${prefix}/${name}` : name;
    let replacement = identifier;
    if (mode === "40000" && (namePath === "src" || namePath.startsWith("src/"))) replacement = treeAt(identifier, namePath);
    if (overrides[namePath]) replacement = files[namePath].blob;
    rewritten.push(Buffer.from(label + "\0"), Buffer.from(replacement, "hex"));
    offset = end + 21;
  }
  const composed = Buffer.concat(rewritten);
  const identifier = objectHash("tree", composed);
  treeProof[identifier] = composed.toString("base64");
  return identifier;
}
const composedTree = treeAt(rawCommits.baseline.tree);
const sourceArchive = { schema: 1, commits: rawCommits, composedTree, treeProof, files };
if (fs.existsSync(path.join(own, "composition.json.gz"))) assert.equal(hash(fs.readFileSync(path.join(own, "composition.json.gz"))), hash(pack(sourceArchive)));
else write(path.join(own, "composition.json.gz"), pack(sourceArchive));
restore(files, path.join(scratch, "composition"));
const toolOrigins = {
  node: fs.realpathSync(process.execPath),
  "node_modules/typescript": fs.realpathSync(path.join(repo, "node_modules/typescript")),
  "node_modules/@types/node": fs.realpathSync(path.join(repo, "node_modules/@types/node")),
  "node_modules/undici-types": fs.realpathSync(path.join(repo, "node_modules/undici-types")),
  npm: fs.realpathSync(path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm")),
};
const toolsRoot = path.join(scratch, "tools");
const tools = {};
for (const [name, origin] of Object.entries(toolOrigins)) {
  const destination = path.join(toolsRoot, name);
  if (fs.statSync(origin).isDirectory()) {
    const source = inventory(origin, true);
    for (const [relative, record] of Object.entries(source)) {
      const target = path.join(destination, relative);
      write(target, fs.readFileSync(path.join(origin, relative)));
      fs.chmodSync(target, record.mode);
    }
    assert.deepEqual(inventory(destination), source);
    tools[name] = { origin, inventory: source };
  } else {
    write(destination, fs.readFileSync(origin)); fs.chmodSync(destination, 0o755);
    tools[name] = { origin, sha256: hash(fs.readFileSync(origin)) };
  }
}
for (const name of ["@types/node", "undici-types"]) fs.cpSync(path.join(toolsRoot, "node_modules", name), path.join(scratch, "composition/node_modules", name), { recursive: true, preserveTimestamps: true });
for (const name of ["cases.mjs", "typed-inputs.ts"]) write(path.join(scratch, "fixtures", name), fs.readFileSync(path.join(frozen, name)));
for (const name of ["home", "cache", "tmp", "artifacts"]) fs.mkdirSync(path.join(scratch, name), { recursive: true });
save("TOOLS.json", tools);
write(path.join(own, "PREPARED-INVENTORY.json.gz"), pack(inventory(scratch)));
save("BINDING.json", {
  schema: "independent-webdav-ca1d/v1", preparedAt: new Date().toISOString(), commits: rawCommits,
  composition: { baseline: commits.baseline, overrides, composedTree, sourceFiles: Object.keys(files).length, archiveSha256: hash(fs.readFileSync(path.join(own, "composition.json.gz"))) },
  originalFreeze: freezeHashes, liveBefore: before, liveStateQualification: "live preservation only, not equality to historical5137",
  authorHandoff: { commit: commits.evidence, path: "tests/fs/webdav/directory-access-author-20260828/HANDOFF.md", sha256: hash(git("show", `${commits.evidence}:tests/fs/webdav/directory-access-author-20260828/HANDOFF.md`)) },
  scratchBeforeBuild: { file: "PREPARED-INVENTORY.json.gz", sha256: hash(fs.readFileSync(path.join(own, "PREPARED-INVENTORY.json.gz"))) }, toolsSha256: hash(fs.readFileSync(path.join(own, "TOOLS.json"))),
});
assert.deepEqual(liveProtected(), before);
originalFreeze();
console.log(JSON.stringify({ composedTree, sourceFiles: Object.keys(files).length, scratch: "prepared; no product execution" }));
