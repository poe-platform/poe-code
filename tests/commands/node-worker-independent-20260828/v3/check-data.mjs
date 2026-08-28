import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const subject = "f9bf774409eca40b0518b322db6fcb652cd6cd7f";
const design = "tests/commands/node-design-20260828/worker-resource-quiescence-proposal-v3";
const preparation = "tests/commands/node-worker-experiments-20260828/preparation-v1";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const started = Date.now(), processes = [], rows = [];
let captured = 0, work = 0, failure;
function git(args, input) {
  assert.ok(processes.length < 3); assert.ok(Date.now() - started < 600000);
  const result = spawnSync("/usr/bin/git", args, { cwd: repository, input, timeout: 30000, maxBuffer: 16 * 1048576, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" } });
  captured += (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0); work += result.stdout?.length ?? 0;
  processes.push({ args, status: result.status, signal: result.signal, error: result.error?.message, stdoutBytes: result.stdout?.length ?? 0, stdoutSha256: digest(result.stdout ?? Buffer.alloc(0)), stderr: result.stderr?.toString() });
  assert.ok(captured <= 32 * 1048576 && work <= 128 * 1048576);
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function batch(requests) {
  const output = git(["cat-file", "--batch"], requests.join("\n") + "\n");
  let offset = 0;
  const result = requests.map(request => {
    const newline = output.indexOf(10, offset); assert.ok(newline >= 0);
    const [blob, kind, sizeText] = output.subarray(offset, newline).toString().split(" "), size = Number(sizeText);
    assert.equal(kind, "blob"); assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= 8 * 1048576);
    const body = output.subarray(newline + 1, newline + 1 + size); assert.equal(body.length, size);
    assert.equal(createHash("sha1").update(Buffer.from(`blob ${size}\0`)).update(body).digest("hex"), blob);
    offset = newline + 2 + size; assert.equal(output[offset - 1], 10);
    return { request, blob, body };
  });
  assert.equal(offset, output.length); return result;
}
try {
  const inventory = git(["ls-tree", "-r", "-z", subject, "--", design, preparation]).toString().split("\0").filter(Boolean).map(record => {
    const tab = record.indexOf("\t"), [mode, kind, blob] = record.slice(0, tab).split(" "), filename = record.slice(tab + 1);
    assert.equal(mode, "100644"); assert.equal(kind, "blob"); assert.ok(filename.startsWith(design + "/") || filename.startsWith(preparation + "/"));
    assert.equal(filename.split("/").includes("AGENTS.md"), false); return { path: filename, blob };
  });
  const bodies = batch(inventory.map(row => row.blob));
  const contents = new Map();
  inventory.forEach((entry, index) => { const body = bodies[index].body; contents.set(entry.path, body); rows.push({ ...entry, bytes: body.length, sha256: digest(body) }); });
  for (const [directory, sealHash] of [[design,"7a89d5911ddadcd7154c84553ce35442e744f2ded14d484af2b4e1bc92fcdacd"],[preparation,"12f754bcb5cbd68bc4fbd7e187a2d529a20769d61b355fd74c3693f50c7d38a9"]]) {
    const sealBytes = contents.get(directory + "/SEAL.json"); assert.equal(digest(sealBytes), sealHash);
    const seal = JSON.parse(sealBytes);
    assert.deepEqual(inventory.filter(row => row.path.startsWith(directory + "/")).map(row => row.path.slice(directory.length + 1)).sort(), ["SEAL.json", ...seal.files.map(row => row.path)].sort());
    for (const record of seal.files) { const body = contents.get(directory + "/" + record.path); assert.equal(body.length, record.bytes); assert.equal(digest(body), record.sha256); }
    for (const record of seal.externalBindings ?? []) { const body = contents.get(record.path); assert.equal(body.length, record.bytes); assert.equal(digest(body), record.sha256); }
  }
  const inputRecords = JSON.parse(contents.get(preparation + "/INPUTS.json")).inputs;
  assert.equal(inputRecords.length, 48);
  const inputBodies = batch(inputRecords.map(record => {
    assert.match(record.commit, /^[a-f0-9]{40}$/); assert.ok(record.path.startsWith("tests/") || record.path.startsWith("src/") || record.path.startsWith("tsconfig"));
    assert.equal(record.path.split("/").some(part => part === ".." || part === "AGENTS.md"), false); return record.commit + ":" + record.path;
  }));
  inputRecords.forEach((record, index) => { const entry = inputBodies[index]; assert.equal(entry.blob, record.blob); assert.equal(entry.body.length, record.bytes); assert.equal(digest(entry.body), record.sha256); });
  const local = rows.map(row => {
    const filename = path.join(repository, row.path), stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink()); const bytes = fs.readFileSync(filename); work += bytes.length;
    return { path: row.path, matchesFrozen: digest(bytes) === row.sha256 };
  });
  console.log(JSON.stringify({ status: "DATA_ONLY", subject, subjectFiles: rows.length, inputRecords: inputRecords.length, liveMatched: local.filter(row => row.matchesFrozen).length, localMismatch: local.filter(row => !row.matchesFrozen), designRPCKeys: Object.keys(JSON.parse(contents.get(design + "/RPC.json"))), designErrorKeys: Object.keys(JSON.parse(contents.get(design + "/ERRORS.json"))), caseKeys: Object.keys(JSON.parse(contents.get(preparation + "/CASES.json"))) }));
} catch (error) { failure = error?.stack ?? String(error); process.exitCode = 1; }
finally {
  const result = { subject, authorDataEvidence: "10f49933f430dccfd828dce1c5339ab8b2851458", status: failure ? "FAILED_DATA_CHECK" : "DATA_ONLY_AUTHENTICATED_NOT_SEMANTIC", failure, sourceInventory: rows, processes, capturedBytes: captured, logicalWorkBytes: work, elapsedMs: Date.now() - started, subjectImports: 0, engineEvaluations: 0, workerAdmissions: 0, compilerInvocations: 0, temporaryRoots: 0 };
  assert.ok(work <= 128 * 1048576);
  fs.writeFileSync(path.join(own, "DATA-RESULT.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, failure, children: processes.length, capturedBytes: captured, logicalWorkBytes: work }));
}
