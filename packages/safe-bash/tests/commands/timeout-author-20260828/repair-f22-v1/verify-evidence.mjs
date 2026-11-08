import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const repository = process.cwd();
const scope = resolve(repository, "tests/commands/timeout-author-20260828/repair-f22-v1");
const requested = process.argv[2];
if (!requested) throw new Error("An evidence directory is required");
const evidence = resolve(repository, requested);
if (dirname(evidence) !== scope || !evidence.startsWith(scope + sep) || !existsSync(evidence)) throw new Error("Evidence must be a direct child of the F22 repair scope");
const sealPath = resolve(evidence, "EVIDENCE-SEAL.json");
const seal = JSON.parse(readFileSync(sealPath, "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");

function visit(directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    if (name === "AGENTS.md") throw new Error(`forbidden instruction file: ${name}`);
    const path = resolve(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`non-regular evidence entry: ${path}`);
    if (stat.isDirectory()) files.push(...visit(path));
    else if (path !== sealPath) {
      const bytes = readFileSync(path);
      files.push({ path: relative(evidence, path).split(sep).join("/"), mode: stat.mode & 0o777, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  return files;
}

const actual = visit(evidence);
assert.deepEqual(actual, seal.files, "sealed evidence has a changed, missing, or appended entry");
assert.equal(sha256(JSON.stringify(actual)), seal.manifestSha256);
process.stdout.write(`${JSON.stringify({ status: "PASS", files: actual.length, manifestSha256: seal.manifestSha256, appendedEntriesDetected: 0 })}\n`);
