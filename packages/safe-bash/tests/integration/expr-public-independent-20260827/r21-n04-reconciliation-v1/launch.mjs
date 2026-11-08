import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, prefix, read, json, digest, objectHash, putJson } from "./common.mjs";
import { git } from "./auth.mjs";
import { sealEvidence } from "./evidence.mjs";

const commit = process.argv[2]; assert.match(commit ?? "", /^[a-f0-9]{40}$/u);
const seal = json(join(directory, "RECIPE-SEAL.json")), pins = json(join(directory, "PINS.json"));
for (const row of seal.entries) { const path = join(directory, row.path); assert.equal(digest(read(path)), row.sha256); assert.equal(lstatSync(path).mode & 0o777, row.mode); assert.ok(git("ls-tree", commit, "--", `${prefix}/${row.path}`).toString().includes(objectHash(read(path)))); }
assert.ok(git("ls-tree", commit, "--", `${prefix}/RECIPE-SEAL.json`).toString().includes(objectHash(read(join(directory, "RECIPE-SEAL.json")))));
assert.equal(process.execPath, pins.runtimes[0].executable); assert.equal(digest(read(process.execPath)), pins.runtimes[0].sha256);
assert.equal(existsSync(join(directory, "work")), false, "one frozen attempt, never retry");
const descriptor = openSync(join(directory, "EXECUTION.raw.txt"), "wx", 0o644);
const startedAt = new Date().toISOString();
console.log(JSON.stringify({ checkpoint: "BEFORE-ACTUAL-EXECUTION", recipe: commit, recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))), expected: pins.counts }));
let bytes = 0, supervision, error, hardTimer;
const child = spawn(process.execPath, [join(directory, "entry.mjs"), commit], { cwd: repository, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
function stop(reason) {
  if (supervision) return; supervision = reason;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  hardTimer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 60000);
}
const timer = setTimeout(() => stop("300s outer deadline"), 300000);
function collect(chunk) {
  bytes += chunk.length; if (bytes > 16777216) { stop("16MiB outer output cap"); return; }
  writeSync(descriptor, chunk); fsyncSync(descriptor); process.stdout.write(chunk);
}
child.stdout.on("data", collect); child.stderr.on("data", collect); child.once("error", caught => { error = caught.stack; });
const outcome = await new Promise(resolve => child.once("close", (status, signal) => resolve({ status, signal, closed: true })));
clearTimeout(timer); clearTimeout(hardTimer); fsyncSync(descriptor); closeSync(descriptor);
const naturalSettlement = !supervision && !error && outcome.signal === null;
const outer = { recipeCommit: commit, startedAt, finishedAt: new Date().toISOString(), childStatus: outcome.status, signal: outcome.signal, closed: outcome.closed, naturalSettlement,
  supervision: supervision ?? null, error, outputBytes: bytes, executable: process.execPath, executableSha256: digest(read(process.execPath)), exitCode: outcome.status === 0 && naturalSettlement ? 0 : 1 };
putJson(join(directory, "OUTER.json"), outer);
const evidence = await sealEvidence(commit, outer);
console.log(JSON.stringify({ checkpoint: "evidence-sealed", qualified: evidence.qualified, counts: evidence.counts, manifest: existsSync(join(directory, "MANIFEST.json")) ? digest(read(join(directory, "MANIFEST.json"))) : null, evidenceSeal: digest(read(join(directory, "EVIDENCE-SEAL.json"))) }));
process.exitCode = evidence.qualified ? 0 : 1;
