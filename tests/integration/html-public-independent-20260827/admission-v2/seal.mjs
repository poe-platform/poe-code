import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileHash, guard, inventory, json } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
guard(process.argv.length === 4 && ["--write", "--check"].includes(process.argv[2]), "CLI", "seal.mjs --write|--check SEAL.json");
const filename = resolve(process.argv[3]);
guard(dirname(filename) === here, "SEAL_LOCATION");
const relative = filename.slice(here.length + 1);
if (process.argv[2] === "--write") {
  const files = inventory(here);
  guard(!Object.hasOwn(files, relative), "SEAL_EXISTS");
  json(filename, { schema: "html-admission-v2-seal/1", at: new Date().toISOString(), scope: "hash and append integrity only, not independent review/public acceptance", files });
} else {
  const seal = JSON.parse(readFileSync(filename));
  const actual = inventory(here);
  delete actual[relative];
  assert.deepEqual(actual, seal.files, "sealed files, content changes and additional file/symlink entries");
  const binding = JSON.parse(readFileSync(join(here, "binding-04/BINDINGS.json")));
  for (const entry of binding.fixtures) assert.equal(fileHash(resolve(here, "../../../..", entry.path)), entry.sha256, entry.path);
}
console.log(JSON.stringify({ operation: process.argv[2], seal: filename, sha256: fileHash(filename), status: "integrity-only-pass" }));
