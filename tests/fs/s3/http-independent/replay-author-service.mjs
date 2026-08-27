import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2]);
const setup = JSON.parse(readFileSync(join(directory, "prepare.json"), "utf8"));
const binary = process.argv[3] ? resolve(process.argv[3]) : join(directory, "minio");
assert.equal(createHash("sha256").update(readFileSync(binary)).digest("hex"), setup.serviceLock.sha256);
const results = [];
for (const suite of ["transport-check", "fallback-check", "guards"]) {
  const args = ["--unhandled-rejections=strict", `tests/fs/s3/http/interop/${suite}.mjs`, binary];
  const child = spawn(process.execPath, args, { cwd: setup.source, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false;
  child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGTERM"); } catch {} }, 90000);
  const result = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (status, signal) => resolve({ status, signal })); });
  clearTimeout(timer);
  assert.equal(timedOut, false, `bounded author service ${suite}`);
  const output = stdout.split("\n").find(line => line.startsWith("/tmp/safe-bash-s3-service-"));
  assert.ok(output, stdout + stderr);
  const names = ["launch.json", "shutdown.json", "reference-vectors.json", "listeners.txt", "transport-results.json", "transport-summary.json", "fallback-results.json", "fallback-summary.json", "guards.json", "profile.json", "requests.json"];
  const evidence = Object.fromEntries(names.filter(name => existsSync(join(output, name))).map(name => [name, name.endsWith(".json") ? JSON.parse(readFileSync(join(output, name), "utf8")) : readFileSync(join(output, name), "utf8")]));
  assert.equal(evidence["shutdown.json"].ownedDataRemoved, true); assert.equal(evidence["shutdown.json"].ownedHomeRemoved, true);
  const expectedStatus = suite === "guards" ? 1 : 0;
  results.push({ suite, args, ...result, expectedStatus, stdout, stderr, output, evidence });
  writeFileSync(join(directory, "author-service-replay.json"), JSON.stringify({ revision: setup.revision, overlay: setup.overlay, httpSha256: setup.httpSha256, sourceHashes: setup.sourceHashes, results }, null, 2));
  console.log(JSON.stringify({ suite, ...result, profile: evidence["profile.json"] ?? evidence["transport-summary.json"] ?? evidence["fallback-summary.json"] }));
  assert.equal(result.status, expectedStatus, stdout + stderr);
}
