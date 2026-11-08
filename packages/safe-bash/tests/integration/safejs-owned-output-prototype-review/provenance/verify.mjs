import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = name => JSON.parse(readFileSync(join(owned, name)));
const before = json("snapshot-before.json");
assert.equal(before.private.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
const engineFiles = Object.entries(before.private.engine).map(([path, entry]) => ({ path, sha256: entry.sha256 }));
assert.equal(hash(JSON.stringify(engineFiles)), "a73fd1b639c73f2bf995867b081ef62bd34e303ea4464921c3bd904bccc3ae7b");
if (process.argv.includes("--private-pin")) {
  console.log(JSON.stringify({ privatePin: "PASS", files: engineFiles.length, privateExecuted: false }));
} else {
  const after = json("snapshot-after.json");
  const assembly = json("assembly.json");
  const proof = json("build-proof.json");
  assert.deepEqual(after.private, before.private);
  assert.equal(after.public.staged, before.public.staged);
  assert.deepEqual(after.publicRootInputs, before.publicRootInputs);
  for (const [path, entry] of Object.entries(before.publicSource)) assert.deepEqual(after.publicSource[path], entry, path);
  function check(root, files) {
    for (const entry of files) {
      const path = join(root, entry.path);
      const stat = lstatSync(path);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), path);
      assert.equal(hash(readFileSync(path)), entry.sha256, path);
    }
  }
  check(join(assembly.task, "inputs"), assembly.frozenInputs);
  check(assembly.candidate, assembly.candidateFiles);
  check(proof.consumer, proof.consumerFiles);
  check(join(assembly.task, "engine"), engineFiles);
  for (const tool of assembly.tooling) check(join(assembly.task, "node_modules", tool.name), tool.files);
  assert.equal(proof.compiledFilesMatched, 708);
  assert.equal(proof.publicBuild.status, 0);
  assert.equal(proof.declarationDiagnostics, 0);
  assert.equal(proof.productExecuted, false);
  assert.equal(proof.engineExecuted, false);
  assert.equal(assembly.evidenceCommit, "e57b5aa16f749b6fac558877dff0712e64df05a8");
  if (!process.argv.includes("--inputs-only")) {
    const seal = json("SEAL.json");
    check(owned, seal.files);
    assert.deepEqual(readdirSync(owned).filter(name => name !== "SEAL.json").sort(), seal.files.map(entry => entry.path).sort());
  }
  console.log(JSON.stringify({ result: "PASS", frozenInputFiles: assembly.frozenInputs.length, candidateFiles: assembly.candidateFiles.length, compiledFiles: proof.compiledFilesMatched, privateFiles: engineFiles.length, productExecuted: false, engineExecuted: false }));
}
