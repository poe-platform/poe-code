import assert from "node:assert/strict";
import { join } from "node:path";
import { directory, repository, owner, candidate, author, freeze, digest, git, blob, read, json, put, putJson, inventory } from "./common.mjs";

const admission = json(join(repository, owner, "component-admission-v1/AUTHENTICATION.json"));
const handoffBytes = blob(author, "tests/plugins/expr-public-author/evidence-v1/REVIEW-HANDOFF.json");
assert.equal(digest(handoffBytes), admission.handoff.sha256);
const handoff = JSON.parse(handoffBytes);
const selected = git("ls-tree", "-rz", candidate, "--", ...admission.selectedSourceInventory.selection).toString().split("\0").filter(Boolean).map(line => {
  const [metadata, path] = line.split("\t"), [mode, type, gitBlob] = metadata.split(" ");
  assert.equal(mode, "100644"); assert.equal(type, "blob"); assert.ok(!path.split("/").includes("AGENTS.md"));
  return { path, mode, type, gitBlob, sha256: digest(blob(candidate, path)) };
});
assert.deepEqual(selected, handoff.sourceInventory); assert.equal(selected.length, 357);
assert.equal(digest(JSON.stringify(selected)), admission.selectedSourceInventory.sha256);
for (const entry of admission.fixtures) assert.equal(digest(read(join(repository, entry.path))), entry.sha256);
for (const entry of handoff.engineBindings) assert.equal(digest(blob(handoff.acceptedEngineCommit, entry.path)), entry.sha256);
const source = blob(freeze, `${owner}/consumer.mjs`).toString();
const previous = '  assert.equal(binding?.du75AcceptedBeforeRun, true);';
const replacement = '  assert.equal(binding?.componentProfile, "EXPR_COMPONENT_ACCEPTED_DU75_HELD");';
assert.equal(source.split(previous).length, 2);
put(join(directory, "consumer-component.mjs"), source.replace(previous, replacement));
for (const name of ["cases.json", "positive.ts.fixture", "negative.ts.fixture"]) put(join(directory, name), blob(freeze, `${owner}/${name}`));
for (const name of ["observer.mjs", "silent-worker.mjs"]) {
  const path = `tests/plugins/expr-public-author/${name}`, bytes = blob(author, path);
  assert.equal(digest(bytes), handoff.observerBindings.find(row => row.path === path).sha256);
  put(join(directory, name), bytes);
}
const toolRoots = [
  { name: "typescript", source: join(repository, "node_modules/typescript"), destination: "node_modules/typescript" },
  { name: "node-types", source: join(repository, "node_modules/@types/node"), destination: "node_modules/@types/node" },
  { name: "undici-types", source: join(repository, "node_modules/undici-types"), destination: "node_modules/undici-types" },
  { name: "npm", source: "/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm", destination: "npm" },
].map(tool => ({ ...tool, version: json(join(tool.source, "package.json")).version, entries: inventory(tool.source, tool.name === "npm") }));
for (const runtime of handoff.runtimeIdentities) assert.equal(digest(read(runtime.executable)), runtime.sha256);
const inputs = { schema: "expr-component-execution-v1", authorizationDate: "2026-08-28", preparedAt: new Date().toISOString(), candidate, tree: handoff.candidateTree,
  handoffSha256: digest(handoffBytes), selected, original: admission.fixtures,
  admissionFiles: inventory(join(repository, owner, "component-admission-v1")), engineBindings: handoff.engineBindings,
  package: handoff.package, packageFiles: handoff.packageFiles, runtimes: handoff.runtimeIdentities, toolRoots,
  delta: { previous, replacement, originalSha256: digest(source), adapterSha256: digest(source.replace(previous, replacement)), caseBodiesUnchanged: true },
  sourceScope: handoff.sourceScopeQualification, productExecutions: 0, holds: ["acceptedDU75", "HTML34", "whole76"],
  preparationNotes: ["Initial inspection output included a truncated handoff; structured bounded reads followed.", "Historical failed evidence-v1/POLICY lookup remains preserved; actual policy is parent POLICY.md.", "Read-only grep of guessed src/plugins/agent-commands.ts failed; no product execution or edit."] };
putJson(join(directory, "INPUTS.json"), inputs);
console.log(JSON.stringify({ stage: "prepared", selected: selected.length, tools: toolRoots.map(tool => ({ name: tool.name, version: tool.version, entries: tool.entries.length })), inputsSha256: digest(read(join(directory, "INPUTS.json"))), productExecutions: 0 }));
