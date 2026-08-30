import { createHash } from "node:crypto";
import { lstat, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = "/tmp/bash-surface-source-v2-t3EFGu";
const scope = resolve("tests/compatibility/bash-surface-20260829");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const captured = [];
let admittedBytes = 0;
async function readBounded(path, cap = 2 * 1024 * 1024) {
  if (path.split("/").some(name => name.toLowerCase() === "agents.md")) throw new Error("Instruction capture denied");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > cap) throw new Error(`Read admission: ${path}`);
  admittedBytes += stat.size;
  if (admittedBytes > 16 * 1024 * 1024) throw new Error("Publication read cap");
  const bytes = await readFile(path);
  if (bytes.length !== stat.size) throw new Error("Read drift");
  captured.push({ path, size: bytes.length, sha256: digest(bytes) });
  return bytes;
}

async function metadata(args, name) {
  const child = spawn("/usr/bin/git", args, { cwd: process.cwd(), env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let size = 0;
  const stdout = [], stderr = [];
  let overflow = false;
  const consume = target => bytes => {
    size += bytes.length;
    if (size > 2 * 1024 * 1024) { overflow = true; child.kill("SIGTERM"); return; }
    target.push(Buffer.from(bytes));
  };
  child.stdout.on("data", consume(stdout));
  child.stderr.on("data", consume(stderr));
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal }));
  });
  const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
  await writeFile(`${root}/${name}.stdout`, out, { flag: "wx" });
  await writeFile(`${root}/${name}.stderr`, err, { flag: "wx" });
  if (overflow || result.code !== 0 || result.signal !== null) throw new Error(`Metadata child failure ${name}`);
  return { args, ...result, stdoutSha256: digest(out), stderrSha256: digest(err), stdoutBase64: out.toString("base64") };
}

await writeFile(`${root}/publication-start.json`, JSON.stringify({ started: new Date().toISOString(), role: "DATA_PUBLICATION_ONLY" }), { flag: "wx" });
try {
  if (process.argv[2] !== "--publish-source-data-only" || process.argv.length !== 3) throw new Error("Explicit mode required");
  const start = JSON.parse(await readBounded(`${root}/START.json`));
  const admission = JSON.parse(await readBounded(`${root}/ADMISSION.json`));
  const cases = JSON.parse(await readBounded(`${scope}/CASES.json`));
  if (cases.count !== 40 || cases.cases.length !== 40 || new Set(cases.cases.map(row => row.id)).size !== 40 || cases.expected !== null) throw new Error("Case census");
  for (const [index, row] of cases.cases.entries()) {
    if (row.id !== `B${String(index + 1).padStart(2, "0")}` || typeof row.program !== "string" || Buffer.byteLength(row.program) > 4096 || row.program.includes("\0")) throw new Error("Literal case admission");
  }
  const inspections = [];
  for (const name of (await readdir(root)).filter(name => /^read-\d+\.json$/.test(name)).sort()) inspections.push(JSON.parse(await readBounded(`${root}/${name}`)));
  const status = await metadata(["status", "--porcelain=v1", "-z", "--untracked-files=no"], "final-tracked-status-nul");
  const index = await metadata(["diff", "--cached", "--name-only", "-z"], "final-index-nul");
  const hashes = [];
  for (const name of ["admit.mjs", "read.mjs", "seal.mjs", "CASES.json", "README.md", "REFERENCES.md", "ORACLE-PROPOSAL.md", "PREPARATION-INCIDENT.md"]) {
    const bytes = await readBounded(`${scope}/${name}`);
    hashes.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  const elapsedMs = Date.now() - Date.parse(start.started);
  if (elapsedMs > 30 * 60 * 1000) throw new Error("Preparation deadline");
  const result = {
    role: "SOURCE_DATA_AUDIT_NOT_RUNTIME_ACCEPTANCE", date: "2026-08-29", elapsedMs,
    candidateTree: admission.candidate, caseIdentities: 40, caseExecutions: 0,
    product: 0, nativeBash: 0, nativeOracles: 0, compiler: 0, builds: 0, installs: 0, private: 0,
    selectedSourceBlobs: admission.selected.length, admittedPublicationReadBytes: admittedBytes,
    inspections: inspections.length, metadataChildren: [status, index], hashes,
    processQualification: "Serial direct source/data helpers and development Git only. No product children; no independent OS descendant census or universal cleanup claim. Tool transcript supplements per-helper closed-child receipts.",
    instructionQualification: "Fresh instruction reads context-only; no AGENTS bodies published. Original c3d79102 deleted-copy/evidence-loss incident unchanged.",
    captureRoot: root, retainedRoots: true, retries: 0,
    referenceQualification: "Official GNU listings/manual verified via hosted web tool, not a local binary version probe.",
    runtimeAcceptance: false
  };
  await mkdir(`${scope}/data`, { recursive: true });
  for (const [name, value] of [["ADMISSION.json", admission], ["INSPECTIONS.json", inspections], ["PREPARATION.json", result], ["READ-BINDINGS.json", captured]]) {
    const output = JSON.stringify(value, null, 2) + "\n";
    if (Buffer.byteLength(output) > 4 * 1024 * 1024) throw new Error("Publication output cap");
    await writeFile(`${scope}/data/${name}`, output, { flag: "wx" });
  }
  await writeFile(`${root}/publication-result.json`, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ elapsedMs, selected: result.selectedSourceBlobs, identities: 40, executed: 0, inspectionFiles: inspections.length, metadataStatuses: [status.code, index.code], foreignTrackedStatusBase64: status.stdoutBase64, stagedPathsBase64: index.stdoutBase64 }));
} catch (error) {
  await writeFile(`${root}/publication-error.json`, JSON.stringify({ error: String(error), stack: error?.stack }), { flag: "wx" });
  throw error;
}
