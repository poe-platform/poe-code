import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const version = "b2-preparation-packet-deriver-r2.1";
const repository = "/Users/kjopek/Workspace/safe-bash";
const namespace = "tests/integration/agent-bash-coherent-b2-preflight-20260829";
const work = "/private/tmp/safe-bash-b2-preparation-r2-01a04d95";
const outerCapture = "/private/tmp/safe-bash-b2-init-r2-01a04d95.log";
const runtimeRoot = "/private/tmp/safe-bash-b2-runtime-PENDING-ROOT-GO";
const producer = "d8524695c472cdea1e506bc234f426b4e6829cce";
const author = "4a0268f2561d3b2aabf7511656baad968ee64986";
const ownerCommit = "8ab0b2875c695c7cf6fbe90080cd083f69ef7146";
const base = "tests/integration/agent-bash-coherent-author-20260829/";
const producerBase = `${base}stage-a-r2/`;
const sourceSha256 = "ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae";
const packageSha256 = "2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca";
const sourceTree = "3adc676a0ab638c9788ef007e465931d65d2c6fe";
const inspectionSha256 = "c9f14318a12caca009018ef60f4deead8b753b633ba9262f2a7c4014b029adb5";
const hash = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const blobHash = buffer => crypto.createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");
const outputs = new Map();
const facts = {};
const blockers = [];
const childStarts = [];
const deadline = fs.statSync(outerCapture).birthtimeMs + 25 * 60 * 1000;

function remaining() {
  assert.ok(Date.now() < deadline - 60000, "preparation active deadline reached; reserve publication time");
}

function admitted(file, maximum, expected) {
  const before = fs.lstatSync(file);
  assert.ok(before.isFile() && before.size <= maximum, `bounded regular file: ${file}`);
  if (expected?.bytes !== undefined) assert.equal(before.size, expected.bytes);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, before.ino);
    assert.equal(opened.dev, before.dev);
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0, "short admitted read");
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    assert.equal(after.size, opened.size);
    assert.equal(after.mtimeMs, opened.mtimeMs);
    if (expected?.sha256) assert.equal(hash(bytes), expected.sha256, file);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function streamedSeal(file, maximum) {
  const before = fs.lstatSync(file);
  assert.ok(before.isFile() && before.size <= maximum, `bounded regular tool: ${file}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const digest = crypto.createHash("sha256");
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, before.ino);
    assert.equal(opened.dev, before.dev);
    const buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (bytes < opened.size) {
      const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, opened.size - bytes), bytes);
      assert.ok(count > 0);
      digest.update(buffer.subarray(0, count));
      bytes += count;
    }
    const after = fs.fstatSync(descriptor);
    assert.equal(after.size, opened.size);
    assert.equal(after.mtimeMs, opened.mtimeMs);
    return { path: file, bytes, sha256: digest.digest("hex"), mode: before.mode & 0o777 };
  } finally { fs.closeSync(descriptor); }
}

function batch(requests, role) {
  remaining();
  const stdoutPath = path.join(work, `${role}.stdout.raw`);
  const stderrPath = path.join(work, `${role}.stderr.raw`);
  const stdout = fs.openSync(stdoutPath, "wx", 0o600);
  let stderr;
  try {
    stderr = fs.openSync(stderrPath, "wx", 0o600);
    const args = ["-c", "gc.auto=0", "-c", "maintenance.auto=false", "-C", repository, "cat-file", "--batch"];
    const result = spawnSync("/usr/bin/git", args, { input: requests.map(row => row.spec).join("\n") + "\n", cwd: work, timeout: 20000, stdio: ["pipe", stdout, stderr], env: { PATH: "/usr/bin:/bin", HOME: work, TMPDIR: work, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" } });
    childStarts.push({ role, executable: "/usr/bin/git", args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null });
    assert.ok(!result.error && result.status === 0 && !result.signal, "known metadata child retirement");
  } finally {
    fs.closeSync(stdout);
    if (stderr !== undefined) fs.closeSync(stderr);
  }
  const raw = admitted(stdoutPath, 24 * 1024 * 1024);
  let offset = 0;
  const rows = requests.map(request => {
    const end = raw.indexOf(10, offset);
    const header = raw.subarray(offset, end).toString();
    const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(header);
    assert.ok(match, `unresolved locator: ${request.spec}: ${header}`);
    const bytes = Number(match[2]);
    const body = raw.subarray(end + 1, end + 1 + bytes);
    assert.equal(body.length, bytes);
    assert.equal(raw[end + 1 + bytes], 10);
    assert.equal(blobHash(body), match[1]);
    offset = end + bytes + 2;
    return { ...request, blob: match[1], bytes, sha256: hash(body), text: body.toString() };
  });
  assert.equal(offset, raw.length);
  return rows;
}

function add(relative, text) {
  assert.ok(relative && !relative.startsWith("/") && !relative.split("/").includes(".."));
  assert.ok(!outputs.has(relative), `duplicate output: ${relative}`);
  outputs.set(relative, text.endsWith("\n") ? text : text + "\n");
}

function json(relative, data) { add(relative, JSON.stringify(data, null, 2)); }
function publicSeal(row) {
  const { text, spec, ...seal } = row;
  return seal;
}

function scanInventory(root) {
  const records = [];
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      if (stat.isDirectory()) visit(filename);
      else {
        assert.ok(stat.isFile(), "owned work contains a nonregular entry");
        records.push({ relative: path.relative(root, filename), ...streamedSeal(filename, 128 * 1024 * 1024) });
      }
    }
  }
  visit(root);
  return Object.freeze(records.map(Object.freeze));
}

try {
  remaining();
  const inspection = JSON.parse(admitted(path.join(work, "inspection.json"), 8 * 1024 * 1024, { sha256: inspectionSha256 }));
  for (const row of [...inspection.metadata, ...inspection.retained]) {
    const bytes = Buffer.from(row.text);
    assert.equal(bytes.length, row.bytes);
    assert.equal(hash(bytes), row.sha256);
    assert.equal(blobHash(bytes), row.blob);
  }
  const byName = Object.fromEntries(inspection.metadata.map(row => [row.name, row]));
  const authorSummary = JSON.parse(byName["author-summary"].text);
  const independent = JSON.parse(byName["independent-result"].text);
  const retained = inspection.retained;
  const harnessNames = ["redirections.mjs", "redirection-cases.json", "close-observer.mjs", "strict.mjs", "strict-design.json", "conditional.mjs", "extension.mjs", "extension-design.json", "arrays.mjs", "ARRAY-CASES.json", "n14.mjs", "resources.mjs", "loader.mjs", "names.mjs"];
  assert.equal(retained.length, harnessNames.length);
  const originEntries = retained.map((row, index) => ({ stagedPath: `runtime/harness/${harnessNames[index]}`, origin: publicSeal(row) }));
  for (let index = 0; index < retained.length; index++) add(originEntries[index].stagedPath, retained[index].text);
  const groupDefinitions = [
    ["redirections-v3", "redirections.mjs", 48, "Unit1-redirections-v3", "redirection-cases.json"],
    ["strict", "strict.mjs", 50, "Unit2-strict-v1", "strict-design.json"],
    ["conditional", "conditional.mjs", 67, "Unit3-conditional-v4", null],
    ["extension", "extension.mjs", 35, "Unit4-extension-v2", "extension-design.json"],
    ["arrays", "arrays.mjs", 12, "arrays-retained-v1", "ARRAY-CASES.json"],
    ["n14", "n14.mjs", 12, "Unit4-N14-v4", null]
  ];
  const layouts = [["source", "source-built"], ["installed", "installed"], ["moved", "physically-moved"]];
  const slots = [];
  const roles = [];
  const selectedLabels = new Set();
  for (const [historicalLayout, layout] of layouts) {
    for (const [group, script, count, fixtureVersion, table] of groupDefinitions) {
      const label = `${historicalLayout}-${group}`;
      const historical = authorSummary.main.find(row => row.label === label);
      assert.equal(historical?.cases, count, `author cohort ${label}`);
      const corroborating = independent.cohorts.find(row => row.label === label);
      const fallback = authorSummary.focused.find(row => row.label === label);
      const rows = corroborating?.cases ?? fallback?.cases;
      assert.equal(rows?.length, count, `literal identity list ${label}`);
      assert.equal(new Set(rows.map(row => row.id)).size, count);
      selectedLabels.add(label);
      const harness = originEntries.find(row => row.stagedPath.endsWith(`/${script}`));
      const literals = table ? JSON.parse(retained[harnessNames.indexOf(table)].text) : null;
      for (const [ordinal, row] of rows.entries()) {
        assert.equal(typeof row.id, "string");
        const literalRow = literals?.cases?.find(candidate => candidate.id === row.id) ?? null;
        slots.push({ slot: `${layout}/${group}/${row.id}`, originalId: row.id, originalCohort: label, layout, group, fixtureVersion: `git-blob:${harness.origin.blob}`, versionQualification: "Authenticated original blob is the fixed version; no new historical identity is invented", ordinal: ordinal + 1, stagedHarness: harness.stagedPath, harnessOrigin: harness.origin, literalTable: table ? `runtime/harness/${table}` : null, literalRow, assertionAuthority: "Complete authenticated harness and referenced fixture table; no historical pass imported as a new outcome", historicalIdentitySource: corroborating ? publicSeal(byName["independent-result"]) : publicSeal(byName["author-summary"]), status: "UNRUN" });
      }
      roles.push({ role: `retained-${layout}-${group}`, kind: "retained", layout, cases: count, expectedIds: rows.map(row => row.id), script: `harness/${script}`, expectedExitCodes: [0], internalLoaderAdmissions: 1, seconds: 420, status: "UNRUN" });
    }
  }
  assert.equal(slots.length, 672);
  assert.equal(new Set(slots.map(row => row.slot)).size, 672);
  for (const [, layout] of layouts) {
    assert.equal(slots.filter(row => row.layout === layout).length, 224);
    assert.equal(slots.filter(row => row.layout === layout && row.group === "strict").length, 50);
  }
  for (const [group] of groupDefinitions) {
    const reference = slots.filter(row => row.layout === "source-built" && row.group === group).map(row => row.originalId);
    for (const [, layout] of layouts) assert.deepEqual(slots.filter(row => row.layout === layout && row.group === group).map(row => row.originalId), reference);
  }
  const excluded = independent.cohorts.filter(row => !selectedLabels.has(row.label)).map(row => ({ originalLabel: row.label, cases: row.cases?.length ?? null, ids: row.cases?.map(item => item.id) ?? [], selectedForB2: false }));
  const oldNovel = excluded.filter(row => row.cases === 16);
  const newIdentity = excluded.filter(row => row.cases === 8);
  const reconciliation = { requestedRetained: 672, independentReportedTotal: 744, declaredOldNovel: 48, declaredNewIdentity: 24, selectedLabels: [...selectedLabels], excludedCohorts: excluded, countQualifiedOldNovelCandidates: oldNovel, countQualifiedNewIdentityCandidates: newIdentity, qualification: "Excluded labels and IDs are preserved literally; cardinality candidates do not invent semantic classifications." };
  if (oldNovel.length !== 3 || newIdentity.length !== 3) blockers.push("Independent 744 decomposition needs label-level confirmation; every nonselected cohort is retained in RECONCILIATION.json, never added to 672.");
  json("RETAINED-672.json", { schema: "b2-fixed-retained-slots-r2.1", denominator: 672, logicalIdentities: 224, layouts: 3, unit2PerLayout: 50, slots });
  json("RECONCILIATION.json", reconciliation);
  facts.retained = { slots: 672, identities: 224, perLayout: 224, unit2PerLayout: 50, unit2Total: 150, groups: groupDefinitions.map(([group, script, count]) => ({ group, script, perLayout: count, allLayouts: count * 3 })) };

  const additional = batch([
    ["selected", producer, `${producerBase}evidence/SELECTED-SOURCE.json`],
    ["emitted", producer, `${producerBase}evidence/EMITTED.json`],
    ["members", producer, `${producerBase}evidence/PACKAGE-MEMBERS.json`],
    ["producer-receipt", producer, `${producerBase}evidence/PACKAGE-OUTPUT-RECEIPT.json`],
    ["producer-root", producer, `${producerBase}evidence/ROOT-IDENTITY.json`],
    ["consumer", author, "tests/integration/git-public-20260829/consumer.ts.fixture"],
    ["owner-common", ownerCommit, `${producerBase}common.mjs`]
  ].map(([name, commit, originalPath]) => ({ name, commit, originalPath, spec: `${commit}:${originalPath}` })), "frozen-binding-reader-03");
  const additionalNames = Object.fromEntries(additional.map(row => [row.name, row]));
  const selected = JSON.parse(additionalNames.selected.text);
  assert.equal(additionalNames.selected.sha256, sourceSha256);
  assert.equal(selected.computedTree, sourceTree);
  assert.equal(selected.inputs.length, 309);
  assert.equal(selected.inputs.filter(row => row.path.endsWith(".ts")).length, 253);
  for (const row of selected.inputs) assert.ok(!row.path.split("/").includes("AGENTS.md"), "instruction bodies are excluded");
  const sourceBodies = batch(selected.inputs.map(row => ({ name: row.path, originalPath: row.path, spec: row.blob })), "selected-source-reader-04");
  for (let index = 0; index < sourceBodies.length; index++) {
    assert.equal(sourceBodies[index].blob, selected.inputs[index].blob);
    assert.equal(sourceBodies[index].bytes, selected.inputs[index].bytes);
    assert.equal(sourceBodies[index].sha256, selected.inputs[index].sha256);
  }
  const emitted = JSON.parse(additionalNames.emitted.text);
  const members = JSON.parse(additionalNames.members.text);
  const producerReceipt = JSON.parse(additionalNames["producer-receipt"].text);
  const producerRoot = JSON.parse(additionalNames["producer-root"].text).physical;
  assert.equal(emitted.length, 1012);
  assert.equal(members.length, 1014);
  assert.equal(producerReceipt.bytes, 930368);
  assert.equal(producerReceipt.sha256, packageSha256);
  assert.equal(producerReceipt.sourceTree, sourceTree);
  assert.equal(producerReceipt.producerClosed, true);
  assert.equal(producerReceipt.role, "NEW_TRUSTED_PRODUCER_OUTPUT_BEFORE_INFLATION");
  const packagePath = path.join(repository, producerBase, "evidence/package/virtual-bash-0.0.0.tgz");
  const packageBuffer = admitted(packagePath, 930368, producerReceipt);
  assert.equal(hash(packageBuffer), packageSha256);
  const emittedRoot = path.join(producerRoot, "source/dist");
  const actualEmitted = [];
  if (fs.existsSync(emittedRoot)) {
    for (const row of emitted) {
      remaining();
      admitted(path.join(emittedRoot, row.path), 8 * 1024 * 1024, row);
      actualEmitted.push({ ...row, observedPath: path.join(emittedRoot, row.path) });
    }
  } else blockers.push(`Actual Stage A emission locator requires resolution: ${emittedRoot}; no package member substituted for a genuine source-dist file.`);
  facts.frozen = { selectedTree: sourceTree, derivedOnly: true, selectedManifestSha256: sourceSha256, sourceInputsAuthenticated: sourceBodies.length, typescriptInputs: 253, producer, emittedDeclared: emitted.length, actualEmittedFreshlyAuthenticated: actualEmitted.length, packageMembers: members.length, compressedPackage: { path: packagePath, bytes: packageBuffer.length, sha256: hash(packageBuffer) }, compressedDecodeCalls: 0, sourceTreeRecomputed: false, sourceTreeQualification: "Manifest authenticated by supplied SHA256; individual blobs authenticated; derived tree is not queried as a Git object." };
  json("FROZEN-BINDINGS.json", { ...facts.frozen, producerReceiptOrigin: publicSeal(additionalNames["producer-receipt"]), producerReceipt, selectedInputs: selected.inputs, actualEmitted, packageMembers: members });

  const ownerRow = byName.owner;
  add("runtime/stage-b0-r3/owner.mjs", ownerRow.text);
  add("runtime/stage-a-r2/common.mjs", additionalNames["owner-common"].text);
  originEntries.push({ stagedPath: "runtime/stage-b0-r3/owner.mjs", origin: publicSeal(ownerRow) }, { stagedPath: "runtime/stage-a-r2/common.mjs", origin: publicSeal(additionalNames["owner-common"]) });
  facts.owner = { source: publicSeal(ownerRow), byteIdentical: hash(Buffer.from(outputs.get("runtime/stage-b0-r3/owner.mjs"))) === ownerRow.sha256, implementedB2Deltas: [], requiredB2Deltas: ["Pass fixed B2 roles instead of four B0 defaults", "Define narrowly declared expected nonzero exits for negative types/mutants/bindings without poisoning valid expected-negative outcomes", "Bind the B2 inclusive clock, work/capture ceilings, phase reserve and per-role ceilings"], qualification: "Exact inherited owner retained as DATA; not imported or executed; previous qualification is not a new B2 qualification." };
  json("OWNER-REUSE.json", facts.owner);

  const executor = byName["author-executor"].text;
  const mutationMatch = /const mutations =\s*(\[[\s\S]*?\n\]);/.exec(executor);
  assert.ok(mutationMatch, "frozen JSON mutation table");
  const mutations = JSON.parse(mutationMatch[1]);
  assert.equal(mutations.length, 7);
  for (const mutation of mutations) {
    const member = emitted.find(row => row.path === mutation.file);
    assert.ok(member);
    mutation.frozenOriginalSha256 = member.sha256;
    mutation.restoreExpectedSha256 = member.sha256;
    if (actualEmitted.length === 1012) {
      const original = admitted(path.join(emittedRoot, mutation.file), 8 * 1024 * 1024, member).toString();
      assert.equal(original.split(mutation.before).length, 2, `single frozen mutation target: ${mutation.id}`);
      mutation.prospectiveMutantSha256 = hash(Buffer.from(original.replace(mutation.before, mutation.after)));
    }
    const script = mutation.script ?? "extension.mjs";
    const environment = { [mutation.script ? "N14_CASE" : "EXT_CASE"]: mutation.case };
    roles.push({ role: `mutant-${mutation.id}`, kind: "mutant", script: `harness/${script}`, layout: "mutant-copy", expectedIds: [mutation.case], expectedExitCodes: [1], environment, internalLoaderAdmissions: 1, seconds: 60, status: "UNRUN" });
    roles.push({ role: `restore-${mutation.id}`, kind: "restore", script: `harness/${script}`, layout: "mutant-copy", expectedIds: [mutation.case], expectedExitCodes: [0], environment, internalLoaderAdmissions: 1, seconds: 60, status: "UNRUN" });
  }
  json("MUTATIONS.json", { source: publicSeal(byName["author-executor"]), mutationCases: 7, restores: 7, mutationScope: "Dedicated future copy only; no product bytes mutated in preparation", expectedDetection: { exitCode: 1, firstCasePass: false, summaryCases: 1 }, expectedRestore: { exitCode: 0, casePass: true, completeMemberHashRestore: true }, mutations });
  const appendMatch = /const original = await fs\.readFile\(path\.join\(harness, 'consumer\.ts\.fixture'\), 'utf8'\) \+ '((?:\\.|[^'])*)';/.exec(executor);
  assert.ok(appendMatch, "frozen conditional type consumer appendix");
  const appendix = JSON.parse('"' + appendMatch[1].replaceAll('"', '\\"') + '"');
  const positive = additionalNames.consumer.text + appendix;
  const negative = positive.replaceAll("// @ts-expect-error", "// removed directive");
  assert.equal(positive.split("// @ts-expect-error").length - 1, 8);
  add("runtime/types/consumer-positive.mts.fixture", positive);
  add("runtime/types/consumer-negative.mts.fixture", negative);
  const typeCommands = [];
  for (const [, layout] of layouts) for (const polarity of ["positive", "negative"]) {
    const negativeRole = polarity === "negative";
    const role = `types-${layout}-${polarity}`;
    const entry = `${runtimeRoot}/tools/typescript/bin/tsc`;
    const filename = `${runtimeRoot}/${layout}/__consumer/consumer-${polarity}.mts`;
    const args = [entry, "--strict", "--exactOptionalPropertyTypes", "--noEmit", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", "--pretty", "false", "--listFiles", "--typeRoots", `${runtimeRoot}/tools/@types`, filename];
    typeCommands.push({ role, layout, fixture: `runtime/types/consumer-${polarity}.mts.fixture`, args, expectedExitCode: negativeRole ? 2 : 0, expectedDiagnostics: negativeRole ? 8 : 0, declarationBinding: "Every compiler-listed product declaration must realpath within the exact layout dist and match frozen shipping member SHA256; no ambient declarations." });
    roles.push({ role, kind: "type-consumer", layout, expectedExitCodes: [negativeRole ? 2 : 0], expectedDiagnostics: negativeRole ? 8 : 0, args, internalLoaderAdmissions: 0, seconds: 120, status: "UNRUN" });
  }
  json("TYPE-CONSUMERS.json", { baseOrigin: publicSeal(additionalNames.consumer), appendixOrigin: publicSeal(byName["author-executor"]), checks: 6, negativeChecks: 3, expectedNegativeDiagnostics: 24, fixturesAreDataOnly: true, typeCommands });
  const bindings = [
    { role: "binding-missing", alteration: { removeInputPath: "index.js" }, expectedDiagnostic: "package binding missing member" },
    { role: "binding-changed", alteration: { inputPath: "shell/parser.js", sha256: "0".repeat(64) }, expectedDiagnostic: "package hash mismatch" }
  ];
  for (const binding of bindings) roles.push({ ...binding, kind: "binding-negative", layout: "physically-moved", script: "harness/strict.mjs", expectedExitCodes: [1], internalLoaderAdmissions: 1, seconds: 60, status: "UNRUN" });
  json("BINDING-CHECKS.json", { checks: 2, origin: publicSeal(byName["author-executor"]), bindings, status: "UNRUN" });
  facts.controls = { types: 6, negativeTypeDiagnostics: 24, mutants: 7, restores: 7, bindings: 2 };

  const edges = [];
  for (const entry of originEntries) {
    const text = outputs.get(entry.stagedPath);
    for (const match of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry.stagedPath), specifier));
        const targetOrigin = originEntries.find(row => row.stagedPath === target);
        assert.ok(targetOrigin, `unmapped staged relative import: ${entry.stagedPath}: ${specifier}`);
        edges.push({ importer: entry.stagedPath, specifier, stagedTarget: target, originalTarget: targetOrigin.origin });
      } else edges.push({ importer: entry.stagedPath, specifier, kind: specifier.startsWith("node:") ? "PINNED_NODE_BUILTIN" : "FROZEN_PUBLIC_PACKAGE_ALIAS", packageSha256: specifier.startsWith("node:") ? null : packageSha256 });
    }
  }
  json("ORIGINS.json", { schema: "b2-original-blob-path-map-r2.1", entries: originEntries, edges, typeDerivations: { base: publicSeal(additionalNames.consumer), appendix: publicSeal(byName["author-executor"]) }, computedImports: "Retained loader/package alias resolution still requires B2 closure review; static edges are not complete runtime load proof." });
  const regexOccurrences = [];
  for (const entry of originEntries.filter(row => row.stagedPath.startsWith("runtime/harness/"))) {
    const lines = outputs.get(entry.stagedPath).split("\n");
    for (const [index, line] of lines.entries()) if (/=~|Regex|Worker|regex/i.test(line)) regexOccurrences.push({ file: entry.stagedPath, line: index + 1, text: line });
  }
  json("REGEX-DERIVATION-INPUTS.json", { retainedSlots: 672, occurrences: regexOccurrences, expectedRegexWorkers: null, expectedRegexLoaderAdmissions: null, status: "PENDING_CASE_DERIVED_CLOSURE", qualification: "Literal occurrences are investigation inputs, not Worker counts; no zero-resource assumption. No paused just-bash instrumentation was imported." });
  assert.equal(roles.length, 40);
  const loaderAdmissions = roles.reduce((sum, role) => sum + role.internalLoaderAdmissions, 0);
  assert.equal(loaderAdmissions, 34);
  const dispatch = roles.filter(role => role.script).map(role => ({ role: role.role, executable: process.execPath, args: ["--loader", `${runtimeRoot}/harness/loader.mjs`, `${runtimeRoot}/${role.layout}/__consumer/${path.basename(role.script)}`], cwd: `${runtimeRoot}/${role.layout}`, environment: { HOME: `${runtimeRoot}/home`, TMPDIR: `${runtimeRoot}/tmp`, TMP: `${runtimeRoot}/tmp`, TEMP: `${runtimeRoot}/tmp`, NODE_OPTIONS: "", NODE_PATH: "", PUBLIC_BINDING: `${runtimeRoot}/bindings/${role.role}.json`, PRODUCT_ROOT: `${runtimeRoot}/${role.layout}`, ...role.environment }, expectedExitCodes: role.expectedExitCodes, expectedIds: role.expectedIds ?? [], status: "PROSPECTIVE_NOT_AUTHORIZED" }));
  json("ROLE-GRAPH.json", { profile: "Known-role-only functional review; no OS containment, universal census or group-absence claim", preparationGrant: { seconds: 1500, knownOsStarts: 56, peakKnownOs: 3, rawCaptureBytes: 100663296, workIncludingPublicationBytes: 536870912, nodeHelperProcesses: 4 }, prospectiveRuntime: { selectedSemanticCalls: 672, excludedAcceptedB0: 39, excludedSeparateB1: 15, exactOverallPlan: 726, consumerAndControlRoles: roles.length, offlineInstallRoles: 1, knownChildRolesBeforeAdministration: 41, internalLoaderAdmissionAttempts: loaderAdmissions, internalLoaderBirths: "UNRUN", regexWorkerCap: "PENDING_CASE_DERIVATION", regexLoaderCap: "PENDING_CASE_DERIVATION", guestEngines: 0, proposedAbsoluteSeconds: 1800, proposedReserveSeconds: 180, proposedRawCaptureBytes: 100663296, proposedWorkBytes: 536870912, totalOsCap: "PENDING_OUTER_AND_PUBLICATION_ROLE_CLOSURE", peakOsCap: 3, authorized: false }, roles, dispatch, install: { status: "PENDING_EXACT_OFFLINE_COMMAND_AND_TOOL_CLOSURE", scripts: "disabled", network: "not authorized", physicallyMoved: "Actual same-filesystem rename with before/after inode/member bindings; never an alias or second extract" } });
  blockers.push("No executable B2 whole-cohort coordinator or qualified expected-nonzero owner delta has been authored; the exact B0 owner is retained unmodified.");
  blockers.push("Regex Worker and Regex-loader ceilings must be derived from the retained case branches; occurrence inventory is not a count. The 34 explicit main-loader admissions do not close that graph.");
  blockers.push("Offline installation/tool closure, source-dist staging, actual rename and complete computed-load bindings require an executable B2 admission/dispatch implementation and independent preexecution review.");
  blockers.push("Fresh root GO and independent review authority remain PENDING; runtime caps are proposals, not this preparation grant.");
  const syntax = [];
  for (const [relative, text] of outputs) if (relative.endsWith(".mjs")) {
    try { new vm.SourceTextModule(text, { identifier: `file://${runtimeRoot}/${relative}` }); syntax.push({ file: relative, parser: "Node22 vm.SourceTextModule parse-only", status: "SYNTAX_OK_NOT_EXECUTED" }); }
    catch (error) { syntax.push({ file: relative, status: "SYNTAX_FAILURE", diagnostic: String(error.stack ?? error) }); throw error; }
  }
  json("SYNTAX.json", syntax);
  const toolSeals = [streamedSeal(process.execPath, 256 * 1024 * 1024), streamedSeal("/usr/bin/git", 64 * 1024 * 1024)];
  assert.equal(toolSeals[0].sha256, "5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011");
  json("AUTHENTICATED-INPUTS.json", { inspection: { bytes: fs.statSync(path.join(work, "inspection.json")).size, sha256: inspectionSha256 }, metadata: [...inspection.metadata, ...additional].map(publicSeal), fixtures: retained.map(publicSeal), tools: toolSeals, toolQualification: "Node/Git freshly sealed; no compiler/npm executed. Complete compiler/npm inventory admission remains mandatory before future use." });
  json("AUTHORITY.json", { status: "PARTIAL_PREEXECUTION_PACKET_NOT_READY", independentReview: "PENDING", rootRuntimeGo: "PENDING", preparationOnly: true, actualRetainedCalls: "UNRUN", actualTypes: "UNRUN", actualMutants: "UNRUN", actualRestores: "UNRUN", actualBindings: "UNRUN", actualWorkers: "UNRUN", guestEngines: 0 });
  json("INITIALIZATION-HISTORY.json", { firstAttempt: { status: "STOP", exit: 127, files: "NONE", diagnostics: "TOOL_TRANSCRIPT_ONLY", rawArtifact: "UNAVAILABLE", qualificationInherited: false, cause: "Reported zsh special path variable assignment replaced PATH; cat/git/find unavailable" }, preparationR2: { capture: outerCapture, exclusiveInitialOpen: true, observedInitialMode: "0644", observedInitialWorkDirectoryMode: "0755", restrictiveUmaskAppliedDuringAdministration: "0077", existingOwnedFilesTightened: "go-rwx", original0600Claim: false, instructionPlaintext: "Initial external operational capture contains instruction reads; retained privately, not copied into repository evidence. This is disclosed, not redacted into manufactured proof.", missingLocator: `${ownerCommit}:${base}stage-b0-r3/HANDOFF.md`, missingLocatorOutcome: "Git batch returned missing; owner resolved from commit change locators and authenticated owner.mjs instead; no source substitution." } });
  const inventory = scanInventory(work);
  const rawBytes = inventory.filter(row => row.relative.endsWith(".raw")).reduce((sum, row) => sum + row.bytes, 0) + fs.statSync(outerCapture).size;
  const ownedBytes = inventory.reduce((sum, row) => sum + row.bytes, 0) + fs.statSync(outerCapture).size;
  assert.ok(rawBytes < 96 * 1024 * 1024);
  assert.ok(ownedBytes + [...outputs.values()].reduce((sum, text) => sum + Buffer.byteLength(text) * 4, 0) < 512 * 1024 * 1024);
  json("PREPARATION-CENSUS.json", { version, sampling: "Invocation-local immutable inventory; not ambient REPL counters", helperChildStarts: [...inspection.census.starts, ...childStarts], helperChildren: 4, helperPeakKnownChildren: 1, knownOsStartsBeforeFinalizer: 42, knownOsStartsThroughFinalizer: 45, expectedPublicationKnownStarts: 10, expectedTotalKnownStarts: 55, ceiling: 56, accounting: "Includes wrapper shells, explicitly invoked metadata/edit/copy/seal utilities and four Node helper/check starts; initial trusted host/zsh startup excluded. This is a declared known-role ledger, not a universal OS descendant census.", peakKnownOs: 3, initialCaptureBytesAtSnapshot: fs.statSync(outerCapture).size, rawBytesAtSnapshot: rawBytes, ownedBytesAtSnapshot: ownedBytes, workInventory: inventory, elapsedSecondsAtSnapshot: (Date.now() - fs.statSync(outerCapture).birthtimeMs) / 1000, deadlineEpochMs: deadline, publicationReserveSeconds: 60, status: "PREPUBLICATION_SNAPSHOT_FINAL_ADMINISTRATION_REMAINS", runtime: { retainedCalls: 0, typeChecks: 0, mutants: 0, restores: 0, bindingChecks: 0, regexWorkers: 0, guestEngines: 0, productImports: 0, decoders: 0 } });
  facts.status = "PARTIAL_PREEXECUTION_PACKET_NOT_READY";
} catch (error) {
  facts.status = "STOP";
  facts.failure = String(error.stack ?? error);
  blockers.unshift("Preparation derivation stopped; retained failure is not retried and no runtime is authorized.");
  console.error(facts.failure);
  process.exitCode = 1;
}

json("STATUS.json", { ...facts, blockers, runtime: "UNRUN", sourceHeadUsedAsAuthority: false });
add("HANDOFF.md", `# B2 preparation-r2: ${facts.status}\n\nAugust 29, 2026. SOURCE/DATA preparation only. This is a precise partial handoff, not READY and not an execution grant.\n\n## Established packet\n\n${facts.retained ? "The literal ledger contains exactly 672 slots: 224 identities in each of source-built, installed and physically-moved. Group counts per layout are 48 redirections, all 50 Unit2 strict identities, 67 conditional, 35 extension, 12 arrays and 12 N14. Every slot retains its original ID, cohort, authenticated original helper path/blob/SHA256, assertion authority and UNRUN status." : "Retained derivation stopped before an exact denominator could be certified; inspect STATUS.json and retained raw diagnostics."}\n\nB0's accepted 39 and B1's separate 15 are excluded: 39 + 15 + 672 = 726. Independent 744 includes the declared additional 48 old-novel and 24 new-identity slots; RECONCILIATION.json preserves nonselected labels/IDs without silently importing them.\n\n${facts.controls ? "The type plan contains six checks and 24 expected negative diagnostics; seven exact mutation recipes each have a restore, plus two loader-binding negatives. These are declarations, not results. Type fixtures are data files and were never compiled." : "Consumer/control derivation is incomplete; no count is promoted to a result."}\n\nThe exact B0 owner is staged with its original common helper and original relative-import graph. No B0 or B1 workflow is duplicated. No new ad hoc runtime supervisor is substituted. No compressed archive is decoded; generated-package authority must precede any later same-buffer decode. Original instruction text is not copied into this repository packet.\n\n## Remaining blockers\n\n${blockers.map(item => `- ${item}`).join("\n")}\n\n## Safety and evidence\n\nThe original initialization STOP remains a reported exit127, no files, tool-transcript-only diagnostics, raw artifact UNAVAILABLE; no old capture qualification is inherited. R2 began with exclusive combined capture. Initial mode0644 and directory0755 were observed and preserved; later captured administration tightened existing owned paths and set umask077. No initial0600 claim is made.\n\nAll actual retained calls, consumers, mutants/restores, bindings, Regex/loader runtime and guest engine execution remain UNRUN. The profile is known-role-only functional review, not OS containment, universal census or group-absence evidence. Capture/integrity/unknown retirement/cap/deadline failures consume the grant; no automatic retry.\n\nExternal raw artifacts remain under ${work} and ${outerCapture}. The initial operational log includes instruction reads and is not duplicated into repository evidence. PREPARATION-CENSUS.json is explicitly a prepublication snapshot; final administration is retained in the outer capture.\n`);

const sealingRows = [...outputs].map(([relative, text]) => ({ path: relative, bytes: Buffer.byteLength(text), sha256: hash(Buffer.from(text)) }));
for (const relative of ["AGENTS.md", "prepare-r2.mjs", "finalize-r2.mjs"]) {
  const file = path.join(repository, namespace, relative);
  const bytes = admitted(file, 128 * 1024);
  sealingRows.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
}
json("SEAL.json", { schema: "b2-partial-packet-seal-r2.1", status: facts.status, domain: "UTF-8 file bytes; relative paths are packet paths, never original repository identities", files: sealingRows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))), selfExcluded: ["SEAL.json"], rootAuthority: "PENDING", reviewAuthority: "PENDING" });
const patch = "*** Begin Patch\n" + [...outputs].map(([relative, text]) => `*** Add File: ${repository}/${namespace}/${relative}\n${text.slice(0, -1).split("\n").map(line => "+" + line).join("\n")}\n`).join("") + "*** End Patch\n";
fs.writeFileSync(path.join(work, "packet.patch"), patch, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ ...facts, blockers, packetFiles: outputs.size, packetPatchBytes: Buffer.byteLength(patch), sealSha256: hash(Buffer.from(outputs.get("SEAL.json"))), childStarts, runtime: "UNRUN" }, null, 2));
