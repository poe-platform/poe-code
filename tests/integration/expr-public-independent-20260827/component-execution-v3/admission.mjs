import assert from "node:assert/strict";
import { appendFileSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, owner, candidate, priorRecipe, legacyDirectory, digest, objectHash, read, json, putJson, inventory } from "./common.mjs";
import { metadata, reader, treeRow } from "./stream-reader.mjs";
import { qualify } from "./qualify.mjs";

export let admitted;
const outputNames = new Set(["EXECUTION.raw.txt", "ADMISSION.json", "ADMISSION.raw.jsonl", "REPORT.json", "RAW.json.gz.base64", "MANIFEST.json", "FINALIZATION.json", "EVIDENCE-SEAL.json", "REPORT.md"]);
const raw = join(directory, "ADMISSION.raw.jsonl");
const record = value => appendFileSync(raw, JSON.stringify(value) + "\n", { flag: "a", mode: 0o644 });
const childReceipts = [];
const receipt = async value => { childReceipts.push(value); record({ kind: "child", ...value }); };
let frozenRows;
const authenticateTool = row => {
  const stat = lstatSync(row.path); assert.ok(stat.isFile()); assert.equal(stat.size, row.bytes); assert.equal(stat.mode & 0o777, row.mode); assert.equal(digest(read(row.path)), row.sha256, row.path);
};
export async function frozenGuard(commit) {
  const prefix = `${owner}/component-execution-v3`;
  const output = await metadata(repository, ["ls-tree", "-rlz", commit, "--", prefix], receipt);
  const rows = output.split("\0").filter(Boolean).map(line => {
    const [attributes, path] = line.split("\t"), [mode, type, objectId, bytes] = attributes.trim().split(/\s+/u);
    assert.equal(mode, "100644"); assert.equal(type, "blob");
    assert.ok(path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes("/"));
    const actual = read(join(repository, path));
    assert.equal(actual.length, Number(bytes)); assert.equal(objectHash(actual), objectId, path);
    assert.equal(lstatSync(join(repository, path)).mode & 0o777, 0o644);
    return { path, mode, type, objectId, bytes: Number(bytes), sha256: digest(actual) };
  });
  assert.ok(rows.some(row => row.path === `${prefix}/entry.mjs`));
  if (frozenRows) assert.deepEqual(rows, frozenRows); else frozenRows = rows;
  const expected = rows.map(row => row.path.slice(prefix.length + 1)).sort();
  const actual = readdirSync(directory).filter(name => name !== "work" && !outputNames.has(name)).sort();
  assert.deepEqual(actual, expected, "new recipe entries");
  return rows;
}
export async function start(commit) {
  assert.match(commit ?? "", /^[a-f0-9]{40}$/u);
  mkdirSync(join(directory, "work"), { recursive: true });
  mkdirSync(join(directory, "work/admission-001"));
  appendFileSync(raw, "", { flag: "wx", mode: 0o644 });
  const report = { schema: "expr-component-reader-admission-v3/1", startedAt: new Date().toISOString(), commit, scope: "EXPRPUBLICCOMPONENT", status: "running", controls: { status: "unrun", pass: 0 }, P01: "unrun", runtimeAssertions: 0, types: 0, acceptedDUGate: "HELD" };
  try {
    const pins = json(join(directory, "PINS.json"));
    for (const tool of pins.tools) authenticateTool(tool);
    assert.equal(process.execPath, pins.tools[1].path);
    record({ kind: "tools-before-launch", tools: pins.tools });
    report.recipe = await frozenGuard(commit);
    const load = reader(repository, pins.catalog, receipt);
    const sample = pins.catalog.find(row => row.commit === priorRecipe && row.path.endsWith("/silent-worker.mjs"));
    report.controls = await qualify({ directory, repository, node: process.execPath, sample, receipt, record: async value => record({ kind: "control", ...value }) });
    const authenticated = [];
    for (const row of pins.catalog.filter(row => row.commit !== candidate)) {
      const local = join(repository, row.path);
      assert.equal(digest(read(local)), row.sha256, row.path);
      assert.equal(lstatSync(local).mode & 0o777, 0o644);
      await load(row.commit, row.path, async () => {});
      authenticated.push({ commit: row.commit, path: row.path, bytes: row.bytes, sha256: row.sha256 });
    }
    report.historicalInputs = authenticated;
    const inputBytes = await load(priorRecipe, `${owner}/component-execution-v1/INPUTS.json`);
    const layoutBytes = await load(priorRecipe, `${owner}/component-execution-v1/LAYOUTS.json`);
    assert.equal(layoutBytes.length, pins.retainedJSON.bytes); assert.equal(digest(layoutBytes), pins.retainedJSON.sha256);
    const inputs = JSON.parse(inputBytes), layouts = JSON.parse(layoutBytes);
    const remap = value => value.replaceAll(legacyDirectory, directory);
    for (const layout of layouts.layouts) {
      const delta = pins.layoutDeltas.find(row => row.name === layout.name); assert.ok(delta);
      layout.consumer = remap(layout.consumer);
      layout.expected = Object.fromEntries(Object.entries(layout.expected).map(([path, sha256]) => [remap(path), sha256]));
      if (layout.forbiddenSource) {
        layout.forbiddenSource = remap(layout.forbiddenSource);
        layout.expected[join(layout.consumer, "node_modules/virtual-bash/dist/index.js")] = delta.poisonEntrypointSha256;
      }
      assert.equal(digest(JSON.stringify(layout.expected)), delta.expectedSha256); layout.expectedSha256 = delta.expectedSha256;
    }
    for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
    const selection = json(join(repository, owner, "component-admission-v1/AUTHENTICATION.json")).selectedSourceInventory.selection;
    const output = await metadata(repository, ["ls-tree", "-rlz", candidate, "--", ...selection], receipt);
    const selected = output.split("\0").filter(Boolean).map(line => {
      const [attributes, path] = line.split("\t"), [mode, type, objectId, bytes] = attributes.trim().split(/\s+/u);
      const row = pins.catalog.find(value => value.commit === candidate && value.path === path); assert.ok(row);
      assert.deepEqual({ mode, type, objectId, bytes: Number(bytes) }, { mode: row.mode, type: row.type, objectId: row.objectId, bytes: row.bytes });
      return { path, mode, type, gitBlob: objectId, sha256: row.sha256 };
    });
    assert.equal(selected.length, 357); assert.deepEqual(selected, inputs.selected);
    assert.equal((await metadata(repository, ["rev-parse", `${candidate}^{tree}`], receipt)).trim(), pins.tree);
    const engine = [];
    for (const binding of inputs.engineBindings) {
      const current = selected.find(row => row.path === binding.path); assert.ok(current);
      assert.equal(current.gitBlob, binding.gitBlob); assert.equal(current.sha256, binding.sha256);
      const accepted = await treeRow(repository, "c3e40f8bd721da5e496f3b3abfd51aee45db5a84", binding.path, receipt);
      assert.equal(accepted.objectId, current.gitBlob); assert.equal(accepted.mode, "100644"); assert.equal(accepted.type, "blob");
      engine.push({ ...binding, acceptedObjectId: accepted.objectId });
    }
    report.engine = { acceptedCommit: "c3e40f8bd721da5e496f3b3abfd51aee45db5a84", unchanged: engine };
    for (const entry of selected) await load(candidate, entry.path, async () => {});
    report.selected = { count: selected.length, inventorySha256: digest(JSON.stringify(selected)), exactTree: pins.tree, authenticatedEveryBlob: true };
    for (const tool of pins.tools) authenticateTool(tool);
    await frozenGuard(commit);
    report.status = "qualified";
    admitted = { commit, inputs, layouts, load, selected, pins };
  } catch (error) { report.status = "HELD"; report.error = { code: error.code, message: error.message, stack: error.stack }; throw error; }
  finally {
    report.finishedAt = new Date().toISOString(); report.childCount = childReceipts.length; report.allChildrenClosed = childReceipts.every(row => row.closed);
    putJson(join(directory, "ADMISSION.json"), report);
    record({ kind: "admission-result", status: report.status, controls: report.controls.pass, allChildrenClosed: report.allChildrenClosed });
  }
}
export async function finalize(commit) {
  const pins = json(join(directory, "PINS.json"));
  for (const tool of pins.tools) authenticateTool(tool);
  const inputs = json(join(legacyDirectory, "INPUTS.json"));
  for (const tool of inputs.toolRoots) assert.deepEqual(inventory(tool.source, tool.name === "npm"), tool.entries);
  for (const row of pins.catalog.filter(row => row.commit !== candidate)) {
    assert.equal(digest(read(join(repository, row.path))), row.sha256); assert.equal(lstatSync(join(repository, row.path)).mode & 0o777, 0o644);
  }
  await frozenGuard(commit);
  assert.ok(childReceipts.every(row => row.closed));
  putJson(join(directory, "FINALIZATION.json"), { status: "pass", finishedAt: new Date().toISOString(), allReaderChildrenClosed: true, readerChildCount: childReceipts.length, recipeNewEntriesChecked: true, toolsNewEntriesChecked: true, originalNineUnchanged: true, admissionFiveUnchanged: true, v1AndV2Unchanged: true, productPasses: 0 });
}
