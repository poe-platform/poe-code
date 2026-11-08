import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(own, "../../..");
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const objectHash = (type, bytes) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
export async function hashExecutable(filename) {
  const before = fs.lstatSync(filename); assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 128 * 1024 * 1024);
  const hash = createHash("sha256"); let length = 0;
  for await (const bytes of fs.createReadStream(filename, { highWaterMark: 65536 })) { length += bytes.length; assert.ok(length <= before.size); hash.update(bytes); }
  const after = fs.lstatSync(filename); assert.equal(after.size, before.size); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(length, before.size);
  return hash.digest("hex");
}
function admitted(name, maximum = 4 * 1024 * 1024) {
  assert.ok(!name.split("/").includes("AGENTS.md"));
  const stat = fs.lstatSync(path.join(repo, name)); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  return fs.readFileSync(path.join(repo, name));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const capture = fs.mkdtempSync("/tmp/bash-conditional-v4-seal-");

  fs.writeFileSync(path.join(capture, "seal-conditional-start.json"), JSON.stringify({ started: new Date().toISOString(), productRuns: 0 }), { flag: "wx" });
  try {
    assert.deepEqual(process.argv.slice(2), ["--seal"]);
    const baseBytes = admitted("tests/compatibility/bash-conditional-author-20260829/SOURCE-v3.json");
    assert.equal(sha(baseBytes), "74c94ab8fb9531f5a704e51d12b6ab713280541758f36cd03de51fe0d630d4da");
    const base = JSON.parse(baseBytes); assert.equal(base.computedTree, "501ad98748e639c909f717007dac4f1da19c67dc");
    const oldSeal = JSON.parse(admitted("tests/compatibility/bash-conditional-author-20260829/PRESEAL-v3.json"));
    const sourceCommit = "7a5c6200";
    const paths = ["src/shell/conditional.ts"];
    const result = spawnSync("/usr/bin/git", ["ls-tree", "-r", "-z", sourceCommit, "--", ...paths], { cwd: repo, maxBuffer: 1048576, timeout: 10000 });
    fs.writeFileSync(path.join(capture, "source-rows.nul"), result.stdout, { flag: "wx" });
    assert.equal(result.status, 0); assert.equal(result.signal, null);
    const overlay = result.stdout.toString().split("\0").filter(Boolean).map(record => {
      const tab = record.indexOf("\t"), [mode, type, blob] = record.slice(0, tab).split(" "), name = record.slice(tab + 1), bytes = admitted(name);
      assert.equal(type, "blob"); assert.equal(objectHash("blob", bytes), blob);
      return { path: name, mode, blob, bytes: bytes.length, sha256: sha(bytes) };
    }); assert.equal(overlay.length, 1);
    const trees = new Map([...base.ancestorTrees, ...base.fetchedTrees, ...base.reconstructedTrees].map(row => [row.oid, Buffer.from(row.base64, "base64")]));
    const witnesses = [];
    function compose(tree, rows) {
      const body = trees.get(tree); assert.ok(body, tree); assert.equal(objectHash("tree", body), tree);
      const entries = new Map();
      for (let cursor = 0; cursor < body.length;) {
        const space = body.indexOf(32, cursor), nul = body.indexOf(0, space); assert.ok(space > cursor && nul > space && nul + 21 <= body.length);
        const nameBytes = body.subarray(space + 1, nul), name = nameBytes.toString(); assert.ok(Buffer.from(name).equals(nameBytes));
        entries.set(name, { mode: body.subarray(cursor, space).toString(), name, oid: body.subarray(nul + 1, nul + 21).toString("hex") }); cursor = nul + 21;
      }
      const groups = new Map();
      for (const row of rows) { const slash = row.path.indexOf("/"); if (slash < 0) entries.set(row.path, { mode: Number.parseInt(row.mode, 8).toString(8), name: row.path, oid: row.blob }); else { const name = row.path.slice(0, slash); if (!groups.has(name)) groups.set(name, []); groups.get(name).push({ ...row, path: row.path.slice(slash + 1) }); } }
      for (const [name, children] of groups) entries.set(name, { mode: "40000", name, oid: compose(entries.get(name).oid, children) });
      const ordered = [...entries.values()].sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === "40000" ? "/" : "")), Buffer.from(right.name + (right.mode === "40000" ? "/" : ""))));
      const bytes = Buffer.concat(ordered.map(row => Buffer.concat([Buffer.from(`${row.mode} ${row.name}\0`), Buffer.from(row.oid, "hex")]))), oid = objectHash("tree", bytes);
      witnesses.push({ oid, base64: bytes.toString("base64") }); return oid;
    }
    const rows = new Map(base.inputs.map(row => [row.path, row])); for (const row of overlay) rows.set(row.path, row);
    const source = { ...base, role: "AUTHOR_CONDITIONAL_PROFILE_REPAIR_V4", base: base.computedTree, baseSourceSha256: sha(baseBytes), overlay, computedTree: compose(base.computedTree, overlay), inputs: [...rows.values()], reconstructedTrees: witnesses, ancestorTrees: [...base.ancestorTrees, ...base.fetchedTrees, ...base.reconstructedTrees], fetchedTrees: [] };
    assert.equal(source.inputs.length, 293);
    const seal = { ...oldSeal, role: source.role, base: source.base, baseSourceSha256: sha(baseBytes), sourceCommit: sourceCommit, bounds: { ...oldSeal.bounds, totalSeconds: 3600, children: 128, loaderAdmissions: 40, regexWorkers: 12, captureBytes: 268435456, scratchBytes: 1073741824 }, expectedInputs: 293, expectedPackageMembers: 954, cohorts: { conditional: 50, strict: 50, redirections: 48, gitPublic: 45, apply: 28, arrays: 12, coherence: 18 }, plannedChildren: { direct: 39, loaders: 29, regexWorkersMax: 12, outerAndDevelopmentReserve: 48 }, resources: "Serial admitted consumers; one fixed loader per consumer, at most two exact RegexWorkers at once; no generic Worker or kernel census claim", exclusions: "No native/oracle/private/network/engine/Node-command/XAN/fullgate; default80 unchanged. Eleven OPEN/OUTSIDE design identities unexecuted; arithmetic/member-length/invalid-tail/diagnostic GNU qualification absent.", executionsAtPreseal: 0 };
    const oldExecutor = JSON.parse(admitted("tests/compatibility/bash-conditional-author-20260829/EXECUTOR-v3.json"));
    seal.bounds = { ...seal.bounds, totalSeconds: 1800, children: 64, loaderAdmissions: 20, regexWorkers: 4, captureBytes: 125829120, scratchBytes: 734003200 }; seal.cohorts = { conditional: 67, strict: 50, redirections: 48, arrays: 12 }; seal.plannedChildren = { direct: 30, loaders: 20, regexWorkersMax: 4, outerAndDevelopmentReserve: 26 };
    seal.masterGrantStarted = new Date().toISOString();
    const ownNames = ["prepare-v4.mjs", "run-v4.mjs", "launch-v4.mjs", "conditional-v4.mjs", "PLAN-v4.md"];
    const names = [...new Set([...oldExecutor.files.map(row => row.path), ...ownNames.map(name => path.relative(repo, path.join(own, name))), "tests/compatibility/bash-strict-mode-design-20260829/CASES.json", "tests/compatibility/bash-redirection-author-20260829/redirections-v2.mjs"])];
    const files = names.map(name => { const bytes = admitted(name); return { path: name, bytes: bytes.length, sha256: sha(bytes) }; });
    for (const row of oldExecutor.files) assert.equal(files.find(file => file.path === row.path).sha256, row.sha256, row.path);
    const sourceText = JSON.stringify(source, null, 2) + "\n", sealText = JSON.stringify(seal, null, 2) + "\n";
    files.push({ path: path.relative(repo, path.join(own, "PRESEAL-v4.json")), bytes: Buffer.byteLength(sealText), sha256: sha(Buffer.from(sealText)) });
    for (const [name, value] of [["SOURCE-v4.json", sourceText], ["PRESEAL-v4.json", sealText], ["EXECUTOR-v4.json", JSON.stringify({ role: source.role, files, source: sha(Buffer.from(sourceText)), executions: 0 }, null, 2) + "\n"]]) fs.writeFileSync(path.join(own, name), value, { flag: "wx" });
    const record = { candidate: source.computedTree, sourceSha256: sha(Buffer.from(sourceText)), inputs: 293, overlay, toolBindings: source.toolBindings, productExecutions: 0 };
    fs.writeFileSync(path.join(capture, "seal-v2-result.json"), JSON.stringify(record, null, 2), { flag: "wx" }); console.log(JSON.stringify(record));
  } catch (error) { fs.writeFileSync(path.join(capture, "seal-v2-error.json"), JSON.stringify({ error: String(error), stack: error.stack }), { flag: "wx" }); throw error; }
}

