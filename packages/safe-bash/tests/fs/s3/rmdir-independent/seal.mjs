import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  assert.equal(entry.isSymbolicLink(), false, "do not seal live external references");
  assert.equal(entry.name.startsWith(".isolated-") || entry.name.startsWith(".audit-"), false, "owned scratch must be removed first");
  const path = join(directory, entry.name);
  return entry.isDirectory() ? files(path) : [path];
});
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const seal = join(owned, "SHA256SUMS");
if (process.argv.includes("--verify")) {
  const records = readFileSync(seal, "utf8").trimEnd().split("\n");
  for (const record of records) {
    const [digest, path] = record.split("  ");
    assert.equal(hash(readFileSync(join(owned, path))), digest, path);
  }
  assert.equal(files(owned).length, records.length + 1);
  console.log(`${records.length} sealed files verified`);
} else {
  const records = files(owned).filter(path => path !== seal).sort().map(path => `${hash(readFileSync(path))}  ${relative(owned, path)}`);
  writeFileSync(seal, records.join("\n") + "\n");
  console.log(`${records.length} files sealed`);
}
