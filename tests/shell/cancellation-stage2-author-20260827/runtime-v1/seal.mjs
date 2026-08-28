import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const [inputRoot, outputPath, ...selected] = process.argv.slice(2);
assert.ok(inputRoot && outputPath && selected.length > 0, "usage: seal.mjs INPUT OUTPUT PATH...");

const root = realpathSync(resolve(inputRoot));
const files = {};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function visit(path) {
  const absolute = join(root, path);
  const stat = lstatSync(absolute);
  assert.equal(stat.isSymbolicLink(), false, `symlink refused: ${path}`);
  if (stat.isDirectory()) {
    for (const name of readdirSync(absolute).sort()) {
      assert.notEqual(name, "AGENTS.md", `AGENTS materialization refused: ${join(path, name)}`);
      visit(join(path, name));
    }
    return;
  }
  assert.equal(stat.isFile(), true, `nonregular entry refused: ${path}`);
  const bytes = readFileSync(absolute);
  files[relative(root, absolute)] = {
    mode: stat.mode & 0o777,
    bytes: bytes.byteLength,
    sha256: hash(bytes),
  };
}

for (const path of selected) visit(path);
writeFileSync(resolve(outputPath), `${JSON.stringify({ algorithm: "sha256", rootRole: "fixed reconstruction product input", files }, null, 2)}\n`);
