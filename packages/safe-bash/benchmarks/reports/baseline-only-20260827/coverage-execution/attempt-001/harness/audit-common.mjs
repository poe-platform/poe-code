import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

export const root = "/Users/kjopek/Workspace/safe-bash";
export const owned = "benchmarks/reports/baseline-only-20260827/coverage-execution";
export const setup = "benchmarks/reports/baseline-only-20260827/coverage-setup";
export const hash = value => createHash("sha256").update(value).digest("hex");
export const json = filename => JSON.parse(readFileSync(filename, "utf8"));
export function publish(filename, value, replace = false) {
  assert.ok(filename.startsWith(`${owned}/`) || filename.startsWith("/tmp/safe-bash-baseline-coverage-"), `Unowned output: ${filename}`);
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  let patch;
  if (existsSync(filename)) {
    assert.ok(replace, `Immutable capture exists: ${filename}`);
    const previous = readFileSync(filename, "utf8");
    patch = `*** Update File: ${filename}\n@@\n${previous.trimEnd().split("\n").map(line => `-${line}`).join("\n")}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n`;
  } else patch = `*** Add File: ${filename}\n${(text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").map(line => `+${line}`).join("\n")}\n`;
  const result = spawnSync("apply_patch", [], { input: `*** Begin Patch\n${patch}*** End Patch\n`, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
export function evidence(filename) {
  const stat = lstatSync(filename);
  const resolved = realpathSync(filename);
  const links = [];
  let prefix = path.parse(path.resolve(filename)).root;
  for (const component of path.resolve(filename).slice(prefix.length).split(path.sep)) {
    prefix = path.join(prefix, component);
    if (lstatSync(prefix).isSymbolicLink()) links.push({ path: prefix, target: readlinkSync(prefix), realpath: realpathSync(prefix) });
  }
  return { path: filename, realpath: resolved, symlink: stat.isSymbolicLink() ? readlinkSync(filename) : null, links, bytes: stat.isDirectory() ? null : readFileSync(filename).length, sha256: stat.isDirectory() ? null : hash(readFileSync(filename)) };
}
export function tree(directory) {
  const entries = [];
  function visit(relative) {
    const filename = path.join(directory, relative);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) {
      entries.push({ path: relative, type: "symlink", target: readlinkSync(filename), realpath: realpathSync(filename), sha256: lstatSync(realpathSync(filename)).isFile() ? hash(readFileSync(filename)) : null });
    } else if (stat.isDirectory()) {
      for (const name of readdirSync(filename).sort()) visit(path.join(relative, name));
    } else entries.push({ path: relative, type: "file", bytes: stat.size, sha256: hash(readFileSync(filename)) });
  }
  visit("");
  return { directory, entries, sha256: hash(JSON.stringify(entries)) };
}
export function errorRecord(error) {
  return { name: error?.name ?? "Error", message: String(error?.message ?? error), code: error?.code ?? null, stack: error?.stack ?? null };
}
