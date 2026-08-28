import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const directory = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(directory, "../../../..");
export const owner = "tests/integration/expr-public-independent-20260827";
export const candidate = "44f00bf84278e3361b52106478d59c707ab7b2bc";
export const author = "8d07bd6e7549aaa9a1096c3e9278b231692bc699";
export const freeze = "f8b982f09e51b9a0a073b0b7bb393cb54796dd62";
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const git = (...args) => execFileSync("/usr/bin/git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 4 * 1024 * 1024 });
export const blob = (ref, path) => git("show", `${ref}:${path}`);
export function read(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { assert.ok(fstatSync(descriptor).isFile(), path); return readFileSync(descriptor); }
  finally { closeSync(descriptor); }
}
export const json = path => JSON.parse(read(path));
export function put(path, bytes, mode = 0o644) {
  assert.ok(path.startsWith(`${directory}/`));
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, bytes, { flag: "wx", mode });
  chmodSync(path, mode);
}
export const putJson = (path, value) => put(path, JSON.stringify(value, null, 2) + "\n");
export function inventory(base, allowBinLinks = false) {
  const rows = [];
  function walk(prefix) {
    assert.ok(lstatSync(join(base, prefix)).isDirectory());
    for (const name of readdirSync(join(base, prefix)).sort()) {
      assert.notEqual(name, "AGENTS.md", "AGENTS never followed/materialized");
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(join(base, path));
      const mode = stat.mode & 0o777;
      if (stat.isSymbolicLink()) {
        assert.ok(allowBinLinks && path.includes("/node_modules/.bin/") || allowBinLinks && path.startsWith("node_modules/.bin/"), path);
        rows.push({ path, kind: "omitted-bin-link", mode, target: readlinkSync(join(base, path)) });
      } else if (stat.isDirectory()) { rows.push({ path, kind: "directory", mode }); walk(path); }
      else { assert.ok(stat.isFile(), path); rows.push({ path, kind: "file", mode, bytes: stat.size, sha256: digest(read(join(base, path))) }); }
    }
  }
  walk("");
  return rows;
}
export function copyInventory(source, target, rows) {
  mkdirSync(target, { recursive: true, mode: 0o755 });
  for (const row of rows) {
    if (row.kind === "omitted-bin-link") continue;
    if (row.kind === "directory") { mkdirSync(join(target, row.path), { recursive: true, mode: row.mode }); chmodSync(join(target, row.path), row.mode); }
    else { const bytes = read(join(source, row.path)); assert.equal(digest(bytes), row.sha256); put(join(target, row.path), bytes, row.mode); }
  }
  assert.deepEqual(inventory(target), rows.filter(row => row.kind !== "omitted-bin-link"));
}
