import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const oid = bytes => crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export async function generate(context) {
  const { repository, namespace, owned, work, stageRoot, inspection, review, read, save, subprocess } = context;
  const generated = new Map();
  const add = (name, text) => { assert.ok(!generated.has(name)); generated.set(name, text.endsWith("\n") ? text : text + "\n"); };
  const addJSON = (name, value) => add(name, JSON.stringify(value, null, 2));
  const git = async (role, args, input) => Buffer.from((await context.git(role, args, { input })).stdout);
  const bindingSpecs = [
    "d8524695c472cdea1e506bc234f426b4e6829cce:tests/integration/agent-bash-coherent-author-20260829/stage-a-r2/evidence/TOOLS-BEFORE.json",
    "8ab0b2875c695c7cf6fbe90080cd083f69ef7146:tests/integration/agent-bash-coherent-author-20260829/stage-b0-r2/stageAProducerPreseal.json"
  ];
  const raw = await git("tool-authority-blobs", ["cat-file", "--batch"], bindingSpecs.join("\n") + "\n");
  let cursor = 0;
  const authorities = bindingSpecs.map(spec => {
    const end = raw.indexOf(10, cursor); const header = /^([a-f0-9]{40}) blob (\d+)$/.exec(raw.subarray(cursor, end).toString()); assert.ok(header, spec);
    const bytes = Number(header[2]); const body = raw.subarray(end + 1, end + 1 + bytes); assert.equal(body.length, bytes); assert.equal(oid(body), header[1]); assert.equal(raw[end + 1 + bytes], 10); cursor = end + bytes + 2;
    return { spec, blob: header[1], bytes, sha256: sha(body), data: JSON.parse(body) };
  });
  assert.equal(cursor, raw.length);
  const toolInventory = authorities[0].data;
  const toolLinks = Object.fromEntries(authorities[1].data.links.map(row => [`${row.package}/${row.path}`, row.target]));
  const tools = "/private/tmp/safe-bash-coherent-stage-a-20260829-r2/tools";
  const packageIdentities = toolInventory.filter(row => row.path.endsWith("/package.json")).map(row => ({ row, identity: JSON.parse(read(path.join(tools, row.path), row, 1048576)) }));
  function toolPackage(name, version) { const candidates = packageIdentities.filter(item => item.identity.name === name && item.identity.version === version); assert.equal(candidates.length, 1, `unique frozen tool package ${name}@${version}`); return candidates[0].row; }
  const compilerPackage = toolPackage("typescript", "5.9.3");
  const npmPackage = toolPackage("npm", "10.9.7");
  const typePackage = toolPackage("@types/node", "22.20.1");
  const slots = JSON.parse(inspection.oldFiles["RETAINED-672.json"]).slots;
  assert.equal(slots.length, 672);
  const mutations = JSON.parse(inspection.oldFiles["MUTATIONS.json"]).mutations;
  const diagnostics = review.negativeTypes[0].errors.map(line => { const match = /\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line); assert.ok(match); return { line: Number(match[1]), column: Number(match[2]), code: Number(match[3]), message: match[4] }; });
  assert.equal(diagnostics.length, 8);
  const mutantFailures = {};
  for (const mutation of mutations) {
    const encoded = review.raw[`v5/${mutation.id}.stdout`]; assert.equal(typeof encoded, "string");
    const output = Buffer.from(encoded, "base64").toString().trim().split("\n").map(line => JSON.parse(line));
    assert.equal(output[0].id, mutation.case); assert.equal(output[0].pass, false); assert.equal(typeof output[0].error, "string");
    mutantFailures[mutation.id] = output[0].error.split("\n").filter(line => !/^\s+at /.test(line)).join("\n");
  }
  const groups = ["redirections-v3", "strict", "conditional", "extension", "arrays", "n14"];
  const scripts = ["redirections.mjs", "strict.mjs", "conditional.mjs", "extension.mjs", "arrays.mjs", "n14.mjs"];
  const roles = [];
  for (const layout of ["source-built", "installed", "physically-moved"]) {
    if (layout === "installed") roles.push({ role: "offline-install", kind: "install", exitCode: 0 });
    for (const [index, group] of groups.entries()) roles.push({ role: `retained-${layout}-${group}`, kind: "retained", layout, script: scripts[index], ids: slots.filter(row => row.layout === layout && row.group === group).map(row => row.originalId), exitCode: 0 });
    for (const negative of [false, true]) roles.push({ role: `types-${layout}-${negative ? "negative" : "positive"}`, kind: "type", layout, negative, exitCode: negative ? 2 : 0 });
  }
  for (const mutation of mutations) for (const kind of ["mutant", "restore"]) roles.push({ role: `${kind}-${mutation.id}`, kind, mutation: mutation.id, layout: "mutant-copy", script: mutation.script ?? "extension.mjs", environment: { [mutation.script ? "N14_CASE" : "EXT_CASE"]: mutation.case }, ids: [mutation.case], exitCode: kind === "mutant" ? 1 : 0 });
  for (const alteration of ["missing", "changed"]) roles.push({ role: `binding-${alteration}`, kind: "binding", alteration, layout: "physically-moved", script: "strict.mjs", exitCode: 1, expectedDiagnostic: alteration === "missing" ? "package binding missing member" : "package hash mismatch" });
  assert.equal(roles.length, 41); assert.equal(roles.filter(row => row.kind === "retained").reduce((sum, row) => sum + row.ids.length, 0), 672);
  assert.equal(roles.filter(row => row.script).length, 34);
  const executionFixtures = Object.entries(inspection.oldFiles).filter(([name]) => name.startsWith("runtime/harness/") && !["names.mjs", "resources.mjs", "loader.mjs"].some(suffix => name.endsWith(suffix)));
  const deniedRoots = /\b(?:grep|egrep|fgrep|rg|sed|expr|node|Worker|RegexExecutor)\b/;
  const rootHits = executionFixtures.flatMap(([file, text]) => text.split("\n").flatMap((line, index) => !/from ["']node:/.test(line) && deniedRoots.test(line) ? [{ file, line: index + 1, text: line }] : []));
  assert.deepEqual(rootHits, [], "literal fixture reaches a Worker-capable command root; static zero cannot be assumed");
  const client = review.sourceByPath["src/commands/regex-execution/client.ts"];
  assert.ok(client.text.includes("private readonly slots = new Set<Slot>();") && client.text.includes("constructor(options: RegexExecutionOptions = defaults) { this.options = policy(options); }") && client.text.includes("while (this.queue.length)"));
  const conditional = review.sourceByPath["src/shell/conditional.ts"];
  assert.ok(!/Worker|RegexExecutor|regex-execution/.test(conditional.text));
  const workerSites = inspection.source.filter(row => row.path.endsWith(".ts") && /new Worker\(/.test(row.text)).map(row => ({ path: row.path, blob: row.blob, sha256: row.sha256 }));
  const regexClosure = { schema: "B2_FIXED_LITERAL_STATIC_CLOSURE_R4", sourceTree: inspection.bindings.selectedTree, fixtureRoots: executionFixtures.map(([file, text]) => ({ file, bytes: Buffer.byteLength(text), sha256: sha(Buffer.from(text)) })), excludedConfigurationOnly: ["names.mjs", "resources.mjs", "loader.mjs"], excludedCommandRoots: ["grep", "egrep", "fgrep", "rg", "sed", "expr", "node"], rootHits, workerSites, client: { path: client.path, blob: client.blob, sha256: client.sha256, constructor: "Policy only; empty slots/queue; Worker Slot allocated by pump only after request queue admission" }, conditional: { path: conditional.path, blob: conditional.blob, sha256: conditional.sha256, profile: "Frozen conditional evaluator does not import Regex execution/Worker; not current HEAD ERE" }, retainedCaseCounts: slots.map(row => ({ slot: row.slot, regexWorkers: 0, regexLoaderAdmissions: 0, guestEngines: 0 })), controlsUseSameFixtureBranches: true, mainAsyncLoaderAdmissions: 34, mainAsyncLoaderPeak: 1, knownOwnedWorkerThreadsTotal: 34, knownOwnedWorkerThreadsPeak: 1, qualification: "Closed trusted literal fixture/command graph and lazy executor construction; not universal dynamic/OS thread census. Old independent 744 zero is not the premise. Node V8/libuv host implementation threads are outside the known owned Worker-role inventory." };
  const recipe = { schema: "B2_RECIPE_R4", roles, expectedDiagnostics: diagnostics, mutations, mutantFailures, toolInventory, toolLinks, compiler: path.join(tools, path.dirname(compilerPackage.path), "bin/tsc"), npm: path.join(tools, path.dirname(npmPackage.path), "bin/npm-cli.js"), typeRoots: path.dirname(path.dirname(path.join(tools, typePackage.path))), toolAuthorities: authorities.map(({ data, ...row }) => row), regexClosure };
  let owner = review.owner;
  const deltas = [];
  function replace(before, after, name) { assert.equal(owner.split(before).length, 2, name); owner = owner.replace(before, after); deltas.push({ name, before, after }); }
  replace("'../stage-a-r2/common.mjs'", "'../legacy/stage-a-r2/common.mjs'", "original common helper relocation");
  replace("assert.ok(Number.isFinite(started)&&seconds>reserve&&reserve>=5);", "assert.ok(Number.isFinite(started)&&Number.isFinite(seconds)&&Number.isFinite(reserve)&&seconds>reserve&&reserve>=5);", "finite clock fields before arithmetic");
  replace("let child,exited=false,closed=false,", "let exitCode=null,exitSignal=null,signalCount=0,observeTimer;let child,exited=false,closed=false,", "natural exit evidence");
  replace("const signal=name=>{if(!child?.pid)return;", "const signal=name=>{if(!child?.pid)return;signalCount++;", "signal evidence");
  replace("closed=true;if(status!==0||signalValue!==null)", "closed=true;exitCode=status;exitSignal=signalValue;if(!(options.allowedExitCodes?.[role]??[0]).includes(status)||signalValue!==null)", "fixed per-role expected exit candidates; classifier decides credit");
  replace("child.stdin.end(input);", "child.stdin.end(input);observeTimer=setInterval(()=>{try{options.observe?.();}catch(error){fail(error,'work-census');}},50);", "bounded live owned work census");
  replace("clearTimeout(deadlineTimer);clearTimeout(killTimer);clearTimeout(drainTimer);", "clearInterval(observeTimer);clearTimeout(deadlineTimer);clearTimeout(killTimer);clearTimeout(drainTimer);", "retire census timer");
  replace("return{stdout:path.join(directory,label+'.stdout')", "return{exitCode,exitSignal,exited,closed,signalCount,stdout:path.join(directory,label+'.stdout')", "return exact natural outcome");
  const tarStart = review.ownerRun.text.indexOf("function unpackVerified("); const tarEnd = review.ownerRun.text.indexOf("\nexport async function main", tarStart); assert.ok(tarStart >= 0 && tarEnd > tarStart);
  const tar = "import assert from 'node:assert/strict';\nimport {gunzipSync} from 'node:zlib';\nimport {sha,safe} from '../legacy/stage-a-r2/common.mjs';\nexport " + review.ownerRun.text.slice(tarStart, tarEnd) + "\n";
  addJSON("DERIVATION-ORIGINS.json", { schema: "B2_R4_AUTHORED_DERIVATIONS", ownerBase: JSON.parse(inspection.oldFiles["OWNER-REUSE.json"]).source, ownerVersion: "b0-r3-b2-negative-outcome-r4.1", ownerDerived: { bytes: Buffer.byteLength(owner), sha256: sha(Buffer.from(owner)) }, deltas, tarBase: { commit: review.ownerRun.commit, originalPath: review.ownerRun.originalPath, blob: review.ownerRun.blob, sha256: review.ownerRun.sha256 }, tarBodyChange: "Unchanged unpackVerified body; explicit wrapper imports/version only", createdBeforeStaging: true });
  add("runtime/owner.mjs", owner); add("runtime/tar.mjs", tar); addJSON("RECIPE.json", recipe); addJSON("REGEX-CLOSURE.json", regexClosure);
  await context.patchFiles([...generated].map(([name, text]) => ({ name, text })));
  return { generated: [...generated.keys()], roles: roles.length, retained: slots.length, types: roles.filter(row => row.kind === "type").length, diagnostics: diagnostics.length * 3, mutations: mutations.length, restores: mutations.length, bindings: 2, runtime: "UNRUN" };
}
