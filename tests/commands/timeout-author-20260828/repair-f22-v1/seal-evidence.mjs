import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const repository = process.cwd();
const scope = resolve(repository, "tests/commands/timeout-author-20260828/repair-f22-v1");
const requested = process.argv[2];
if (!requested) throw new Error("An evidence directory is required");
const evidence = resolve(repository, requested);
if (dirname(evidence) !== scope || !evidence.startsWith(scope + sep) || !existsSync(evidence)) throw new Error("Evidence must be a direct child of the F22 repair scope");
const seal = resolve(evidence, "EVIDENCE-SEAL.json");
if (existsSync(seal)) throw new Error("Evidence seal already exists");
const sha256 = value => createHash("sha256").update(value).digest("hex");

function visit(directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    if (name === "AGENTS.md") throw new Error(`forbidden instruction file: ${name}`);
    const path = resolve(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`non-regular evidence entry: ${path}`);
    if (stat.isDirectory()) files.push(...visit(path));
    else {
      const bytes = readFileSync(path);
      files.push({ path: relative(evidence, path).split(sep).join("/"), mode: stat.mode & 0o777, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
  }
  return files;
}

const before = visit(evidence);
const manifestSha256 = sha256(JSON.stringify(before));
writeFileSync(seal, `${JSON.stringify({
  schema: "timeout-f22-repair-evidence-seal/1",
  evidence: relative(repository, evidence),
  files: before,
  fileCount: before.length,
  totalBytes: before.reduce((sum, file) => sum + file.bytes, 0),
  manifestSha256,
  symlinks: 0,
  nonRegularEntries: 0,
  instructionFiles: 0,
  concurrentAppendCheck: true,
  laterAppendDetectionRequiresVerifier: true
}, null, 2)}\n`);
const after = visit(evidence).filter(file => file.path !== "EVIDENCE-SEAL.json");
if (sha256(JSON.stringify(after)) !== manifestSha256) throw new Error("Evidence changed or gained an entry while sealing");
