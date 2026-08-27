import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

export const root = "/Users/kjopek/Workspace/safe-bash";
export const owned = "benchmarks/reports/baseline-only-20260827/coverage-review/measured";
export const execution = "benchmarks/reports/baseline-only-20260827/coverage-execution";
export const setup = "benchmarks/reports/baseline-only-20260827/coverage-setup";
export const hash = value => createHash("sha256").update(value).digest("hex");
export const json = filename => JSON.parse(readFileSync(filename, "utf8"));
export const ordered = values => [...new Set(values)].sort();
export const read = filename => readFileSync(filename, "utf8");
export function publish(filename, value) {
  assert.ok(filename.startsWith(`${owned}/`) && !filename.includes(".."));
  assert.ok(!existsSync(filename), `Immutable review evidence already exists: ${filename}`);
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${filename}\n${text.replace(/\n$/, "").split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
export function evidence(filename) {
  const absolute = path.resolve(filename);
  const stat = lstatSync(absolute);
  const realpath = realpathSync(absolute);
  const links = [];
  let prefix = path.parse(absolute).root;
  for (const component of absolute.slice(prefix.length).split(path.sep)) {
    prefix = path.join(prefix, component);
    if (lstatSync(prefix).isSymbolicLink()) links.push({ path: prefix, target: readlinkSync(prefix), realpath: realpathSync(prefix) });
  }
  return { path: filename, realpath, links, symlink: stat.isSymbolicLink() ? readlinkSync(absolute) : null, sha256: stat.isDirectory() ? null : hash(readFileSync(absolute)) };
}
export function tree(directory) {
  const entries = [];
  function visit(relative) {
    const filename = path.join(directory, relative);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) entries.push({ path: relative, type: "symlink", target: readlinkSync(filename), realpath: realpathSync(filename), sha256: lstatSync(realpathSync(filename)).isFile() ? hash(readFileSync(filename)) : null });
    else if (stat.isDirectory()) for (const name of readdirSync(filename).sort()) visit(path.join(relative, name));
    else entries.push({ path: relative, type: "file", bytes: stat.size, sha256: hash(readFileSync(filename)) });
  }
  visit("");
  return { directory, entries, sha256: hash(JSON.stringify(entries)) };
}
export function errorRecord(error) {
  return { name: error?.name, message: String(error?.message ?? error), code: error?.code ?? null, stack: error?.stack ?? null };
}
export function knownFiles(manifest, inputs) {
  const known = new Map();
  for (const dependency of manifest.dependencies) for (const entry of dependency.entries) if (entry.sha256) known.set(path.resolve(dependency.directory, entry.path), entry.sha256);
  for (const entry of manifest.snapshot.entries) {
    const filename = path.join(inputs.paths.snapshot, "src", entry.path);
    known.set(filename, entry.sha256);
    known.set(realpathSync(filename), entry.sha256);
  }
  for (const entry of manifest.harness) known.set(path.resolve(entry.path), entry.sha256);
  return known;
}
