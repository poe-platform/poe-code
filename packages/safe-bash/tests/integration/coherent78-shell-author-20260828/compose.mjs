import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(own, "../../..");
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
export const blob = (revision, filename) => git("show", `${revision}:${filename}`);
export const entries = tree => git("ls-tree", "-z", tree).toString().split("\0").filter(Boolean).map(line => {
  const tab = line.indexOf("\t"), [mode, kind, oid] = line.slice(0, tab).split(" ");
  return { mode, kind, oid, name: line.slice(tab + 1) };
});
export function overlayTree(tree, overrides, prefix = "") {
  const items = entries(tree).map(entry => {
    const filename = prefix + entry.name;
    if (overrides.has(filename)) return { ...entry, oid: overrides.get(filename) };
    if (entry.kind === "tree" && [...overrides.keys()].some(name => name.startsWith(filename + "/"))) return { ...entry, oid: overlayTree(entry.oid, overrides, filename + "/") };
    return entry;
  });
  const payload = Buffer.concat(items.map(entry => Buffer.concat([Buffer.from(`${parseInt(entry.mode, 8).toString(8)} ${entry.name}\0`), Buffer.from(entry.oid, "hex")])));
  return createHash("sha1").update(Buffer.from(`tree ${payload.length}\0`)).update(payload).digest("hex");
}
export function authenticate(manifest) {
  const contents = new Map();
  for (const input of manifest.inputs) {
    assert.ok(input.path === "README.md" || input.path === "package.json" || input.path.startsWith("tsconfig") || input.path.startsWith("src/"));
    assert.ok(!input.path.split("/").includes("AGENTS.md"));
    assert.equal(contents.has(input.path), false);
    const bytes = blob(input.revision, input.path);
    assert.equal(sha256(bytes), input.sha256, input.path);
    assert.equal(bytes.length, input.bytes, input.path);
    assert.equal(createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex"), input.blob, input.path);
    contents.set(input.path, bytes);
  }
  const baseTree = git("rev-parse", `${manifest.base}^{tree}`).toString().trim();
  assert.equal(overlayTree(baseTree, new Map()), baseTree);
  const overrides = new Map(manifest.inputs.filter(input => input.revision !== manifest.base).map(input => [input.path, input.blob]));
  assert.equal(overrides.size, 5);
  assert.equal(overlayTree(baseTree, overrides), manifest.composedTree);
  const dotBase = git("rev-parse", `${manifest.dotglobBase}^{tree}`).toString().trim();
  const dotOverrides = new Map([...overrides].filter(([name]) => name !== "src/commands/structured/interpreter.ts"));
  assert.equal(overlayTree(dotBase, dotOverrides), manifest.acceptedDotglobTree);
  const packageJson = JSON.parse(contents.get("package.json"));
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.equal(Object.keys(packageJson[key] ?? {}).length, 0, key);
  assert.equal(packageJson.name, "virtual-bash");
  return contents;
}
export function materialize(contents, destination) {
  assert.equal(fs.existsSync(destination), false);
  fs.mkdirSync(destination);
  for (const [filename, bytes] of contents) {
    const target = path.join(destination, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o644 });
  }
}
export function inventory(directory) {
  const output = {};
  const walk = relative => {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      const key = relative ? `${relative}/${name}` : name, filename = path.join(directory, key), stat = fs.lstatSync(filename);
      assert.ok(!stat.isSymbolicLink(), key);
      if (stat.isDirectory()) { output[key + "/"] = { kind: "directory", mode: stat.mode & 0o777 }; walk(key); }
      else { assert.ok(stat.isFile()); const bytes = fs.readFileSync(filename); output[key] = { kind: "file", bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha256(bytes) }; }
    }
  };
  walk(""); return output;
}
