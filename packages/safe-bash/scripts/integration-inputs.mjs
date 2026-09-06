import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAdmittedInputPath, assertLiteralInputPath, readIntegrationTypeInputs, readRegularInput } from "./typecheck-integration-inputs.mjs";

const removedGitFixtureDirectories = [
  "tests/commands/git-author-20260828",
  "tests/commands/git-design-20260828",
  "tests/commands/git-independent-20260828",
  "tests/commands/git-pack-author-20260828",
  "tests/commands/git-pack-design-20260828",
  "tests/commands/git-pack-independent-20260828",
  "tests/integration/git-public-20260829",
  "tests/integration/git-public-independent-20260829",
  "tests/integration/git-public-loader-review-20260829"
];

function isRemovedGitFixturePath(path) {
  return removedGitFixtureDirectories.some(directory => path === directory || path.startsWith(directory + "/"));
}

const importRetirementId = "import-697ad-verification-tools-retired-789";
const importRetirementOwner = Object.freeze(
{
  "path": "integration-lint-audit/import-697ad-verification-retirement.json",
  "bytes": 500695,
  "sha256": "9f73d12df64ba05609d58e8e591828d246bf0eab2276167f43caf5f46fa5aa49"
}
);
const importRetirementPathsSha256 = "2a412d0308a001e305a92fec4b040790805bcdcf496c2e0acf53bb2fda59af48";
const retainedImportRetirementPathsSha256 = "9dbb986a822aae58f2657a3d457f8708ff42b4a0b75811caa673a4b81fe47553";
const importRetirementHeaderSha256 = "f1922f25c5ff4334b44740d9061c2c20ee07361eaef809b25c1303c4d68a45ee";
const importRetirementProvenanceOwners = [
  "tests/comparison/breadth-continuation-20260828/executor-v7/test-worker.mjs",
  "tests/compatibility/bash-conditional-author-20260829/run-v5.mjs",
  "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/seal-v2.mjs",
  "tests/stress/regex-execution/production-review/freeze.mjs"
];

const nativeData = "tests/commands/regex-execution/continuation/artifacts/native";

const archivedLauncherBase = "tests/integration/full-gate-20260827/unified76-driver/launcher-v3";
const archivedLauncherFiles = [
  "common.mjs",
  "profile.mjs",
  "admission.mjs",
  "inventory.mjs",
  "run.mjs",
  "worker.mjs",
  "supervise.mjs",
  "execute.mjs",
  "policy.mjs",
  "transport.mjs",
  "external.mjs",
  "external-admission.mjs",
  "built-consumers.mjs",
  "consumer-admission.mjs",
  "tap.mjs",
  "public.mjs",
  "build-audit.mjs",
  "build-types.mjs",
  "phase-runner.mjs",
  "process-observer.mjs",
  "review-build-types.mjs",
  "review-build-types-worker.mjs",
  "projection.mjs",
  "os-instruction-fence.mjs",
  "fenced-supervisor.mjs",
  "tool-routing.mjs",
  "historical-eligibility.mjs",
  "maintained-prerequisites.mjs"
];
const archivedLauncherOtherFiles = [
  "CANDIDATE.json",
  "PROFILE.json.gz.base64",
  "PROFILE-RECEIPT.json",
  "CLEANUP.json",
  "EXTERNAL.json.gz.base64",
  "EXTERNAL-RECEIPT.json",
  "consumer.mts.fixture",
  "negative.mts.fixture",
  "INSTRUCTION-PROJECTION.json",
  "OS-INSTRUCTION-FENCE.json",
  "TOOL-ROUTES.json",
  "ELIGIBILITY.json"
];

const successorProofs = [
  {
    "id": "candidate7-01-failed-attempt-capture",
    "role": "immutable-harness-capture",
    "owner": "tests/compatibility/bash-conditional-author-20260829/EXECUTOR-v4.json",
    "selector": "/files/61",
    "pathBase": ".",
    "member": "tests/compatibility/bash-conditional-author-20260829/run-v4.mjs",
    "sizeField": "bytes",
    "historical": false
  },
  {
    "id": "candidate7-02-failed-attempt-capture",
    "role": "immutable-harness-capture",
    "owner": "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/BUILD-PRESEAL.json",
    "selector": "/fixtures/2",
    "pathBase": ".",
    "member": "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/host-doubles.mjs",
    "sizeField": "size",
    "historical": true
  },
  {
    "id": "candidate7-06-failed-attempt-capture",
    "role": "immutable-harness-capture",
    "owner": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/ARTIFACTS.json",
    "selector": "/files/27",
    "pathBase": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10",
    "member": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/seal.mjs",
    "sizeField": "bytes",
    "historical": false
  },
  {
    "id": "candidate7-07-content-binding-refusal",
    "role": "generated-negative",
    "owner": "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/ACTUAL-01/RESULT.json",
    "selector": "/finalCensus/0",
    "pathBase": ".",
    "member": "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/ACTUAL-01/work/changed.js",
    "sizeField": "size",
    "historical": true
  },
  {
    "id": "regex-design-revised-controlled-prototype",
    "role": "controlled-prototype-source",
    "owner": "tests/stress/regex-execution/design/revision/evidence/build.json",
    "selector": "/source/tests~1stress~1regex-execution~1design~1client.ts",
    "pathBase": ".",
    "member": "tests/stress/regex-execution/design/client.ts"
  }
];

function validatePath(path, prefix, file) {
  assertLiteralInputPath(path);
  const segments = path.split("/");
  assert.ok(path.startsWith(`${prefix}/`) && segments.length >= 3, `boundary is too broad: ${path}`);
  if (file) assert.ok(path.endsWith(file), `unexpected boundary file type: ${path}`);
}

export function validateBoundaries(boundaries) {
  assert.equal(boundaries.version, 1, "unsupported integration boundary version");
  assert.ok(Array.isArray(boundaries.heldSourceFiles));
  assert.ok(Array.isArray(boundaries.heldEvidenceDirectories));
  assert.ok(Array.isArray(boundaries.fixtureDirectories));
  for (const path of boundaries.heldSourceFiles) {
    validatePath(path, "src");
    assert.ok(path.endsWith(".ts") || path.endsWith(".md"), `unexpected held source file type: ${path}`);
  }
  for (const path of boundaries.heldEvidenceDirectories) validatePath(path, path.startsWith("src/") ? "src" : "tests");
  for (const fixture of boundaries.fixtureDirectories) {
    validatePath(fixture.path, "tests");
    validatePath(fixture.owner, "tests", ".mjs");
    assert.ok(!boundaries.heldEvidenceDirectories.some(directory => fixture.owner.toLowerCase() === directory.toLowerCase() || fixture.owner.toLowerCase().startsWith(`${directory.toLowerCase()}/`)), "fixture owner must not read held evidence");
    assert.ok(typeof fixture.sha256 === "string" && fixture.sha256.length === 64 && [...fixture.sha256].every(character => "0123456789abcdef".includes(character)), "fixture owner needs a SHA-256 binding");
  }
  const paths = integrationExclusions(boundaries);
  assert.equal(new Set(paths).size, paths.length, "duplicate integration boundary");
  return boundaries;
}

export function loadBoundaries(root, fileSystem = fs) {
  const boundaries = validateBoundaries(JSON.parse(readRegularInput(root, "integration-boundaries.json", 300000, fileSystem).toString("utf8")));
  for (const fixture of boundaries.fixtureDirectories) {
    const bytes = readRegularInput(root, fixture.owner, 300000, fileSystem, boundaries);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256, `fixture owner changed: ${fixture.owner}`);
  }
  return boundaries;
}

export function integrationExclusions(boundaries) {
  return [...boundaries.heldSourceFiles, ...boundaries.heldEvidenceDirectories, ...boundaries.fixtureDirectories.map(fixture => fixture.path)];
}

export function discoverTests(root, boundaries, fileSystem = fs) {
  const directories = [nativeData, ...boundaries.heldEvidenceDirectories, ...boundaries.fixtureDirectories.map(fixture => fixture.path)];
  const files = fileSystem.globSync("tests/**/*.test.ts", {
    cwd: root,
    exclude: path => directories.some(directory => path === directory || path.startsWith(`${directory}/`)),
  }).sort();
  assert.ok(files.length > 0, "No test files found");
  return files;
}

export function lintInventoryPaths(captured, staged, inventory) {
  const capturedRoot = "tests/commands/filesystem-inspection-stress/tree/sealed/inputs";
  const stagedRoot = "tests/integration/du-overlay-independent-20260827";
  for (const entry of captured.entries) {
    validatePath(entry.path, capturedRoot, ".ts");
    validatePath(entry.originalPath, "src/contracts", ".ts");
    assert.equal(entry.classification, "immutable-flattened-source-capture");
  }
  for (const entry of staged.entries) {
    validatePath(entry.path, stagedRoot, ".ts");
    validatePath(entry.owner.path, stagedRoot, ".json");
    assert.ok(["versioned-template", "reusable-template", "sealed-capture"].includes(entry.role));
    assert.equal(entry.currentGroup, "du-leaf");
  }
  for (const entry of inventory.entries) {
    validatePath(entry.path, "tests", ".mts");
    assert.ok(["current", "negative-types", "declaration", "frozen-evidence", "frozen-oracle"].includes(entry.classification), `unknown inventory role: ${entry.path}`);
    assert.ok(typeof entry.sha256 === "string" && entry.sha256.length === 64 && [...entry.sha256].every(character => "0123456789abcdef".includes(character)), `unbound inventory entry: ${entry.path}`);
  }
  return [
    ...captured.entries.map(entry => entry.path),
    ...staged.entries.map(entry => entry.path),
    ...inventory.entries.filter(entry => ["frozen-evidence", "frozen-oracle"].includes(entry.classification)).map(entry => entry.path),
  ];
}

export function readTypecheckInventories(root, boundaries, fileSystem = fs) {
  const directory = "tests/plugins/qualified-current-release";
  const inventories = [
    ["captured-types.json", "70fcd5c2b8d8baec26c2c69cc3fb9110de75366757bf36416b52d7838f4b961f"],
    ["staged-types.json", "74c0e75d5ae06a28db0647545387a2827ca3d51394aae19c4656dcb6bf9a1e43"],
    ["inventory.json", "d37050116db1d1440f8e40dd1403249f60eac21c5566ae36272dc08bd04d3e1d"],
  ].map(([name, expected]) => {
    const bytes = readRegularInput(root, `${directory}/${name}`, 300000, fileSystem, boundaries);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, `unapproved type/lint inventory: ${name}`);
    return JSON.parse(bytes);
  });
  const paths = lintInventoryPaths(...inventories);
  return { captured: inventories[0], staged: inventories[1], inventory: inventories[2], paths };
}

export function validateImportRetirement(record, receipt, boundaries) {
  function keys(value, expected) {
    assert.ok(value && typeof value === "object" && !Array.isArray(value), "retirement object required");
    assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), "unknown retirement fields");
  }
  keys(receipt, ["version", "id", "import", "decision", "selection", "preservation", "evidence", "files"]);
  const { files, ...header } = receipt;
  assert.equal(createHash("sha256").update(JSON.stringify(header)).digest("hex"), importRetirementHeaderSha256, "retirement authorization or qualification changed");
  assert.ok(files && typeof files === "object" && !Array.isArray(files), "retirement file map required");
  const paths = Object.keys(files);
  assert.equal(paths.length, 789, "retirement requires exactly789 paths");
  assert.equal(createHash("sha256").update(JSON.stringify(paths)).digest("hex"), importRetirementPathsSha256, "retirement literal set changed");
  const retainedPaths = paths.filter(path => !isRemovedGitFixturePath(path));
  assert.deepEqual(record.members.map(member => member.path), retainedPaths, "retirement inventory and retained receipt paths differ");
  const retainedMembers = new Map(record.members.map(member => [member.path, member]));
  const eligibility = new Set();
  const current = new Set();
  for (const path of paths) {
    assertAdmittedInputPath(path, boundaries);
    const row = files[path];
    keys(row, ["parentTree", "mode", "blobOid", "bytes", "sha256", "purpose", "eligibilityPointer", "currentProof"]);
    for (const oid of [row.parentTree, row.blobOid]) assert.ok(typeof oid === "string" && oid.length === 40 && [...oid].every(character => "0123456789abcdef".includes(character)), "invalid retirement Git tuple");
    assert.equal(row.mode, "100644", "retirement member must retain its regular Git mode");
    if (retainedMembers.has(path)) assert.deepEqual({ path, bytes: row.bytes, sha256: row.sha256 }, retainedMembers.get(path), "retirement member binding changed");
    assert.ok(typeof row.purpose === "string" && row.purpose.length > 0 && row.purpose.length <= 8192, "affirmative retirement purpose required");
    assert.ok(typeof row.eligibilityPointer === "string", "retirement eligibility selector required");
    const position = Number(row.eligibilityPointer.slice(9));
    assert.ok(Number.isSafeInteger(position) && position >= 0 && position < 814 && row.eligibilityPointer === "/records/" + position && !eligibility.has(position), "invalid retirement eligibility selector");
    eligibility.add(position);
    assert.ok(typeof row.currentProof === "string", "retirement current proof required");
    const [packet, entry, ...extra] = row.currentProof.split("/");
    const proof = Object.hasOwn(receipt.evidence.currentProofs, packet) && receipt.evidence.currentProofs[packet];
    const offset = Number(entry);
    assert.ok(proof && extra.length === 0 && Number.isSafeInteger(offset) && offset >= 0 && offset < proof.rows && String(offset) === entry && !current.has(row.currentProof), "invalid retirement current proof selector");
    current.add(row.currentProof);
  }
}

export function verifyLintInventory(root, inventory, boundaries, fileSystem = fs) {
  function fields(value, required, optional = []) {
    assert.ok(value && typeof value === "object" && !Array.isArray(value), "invalid lint inventory object");
    assert.ok(required.every(key => Object.hasOwn(value, key)), "missing lint inventory field");
    assert.ok(Object.keys(value).every(key => required.includes(key) || optional.includes(key)), "unknown lint inventory field");
  }
  function text(value) {
    assert.ok(typeof value === "string" && value.length > 0 && value.length <= 8192, "invalid lint inventory text");
  }
  function path(value) {
    assertAdmittedInputPath(value, boundaries);
  }
  function binding(value) {
    fields(value, ["path", "bytes", "sha256"]);
    path(value.path);
    assert.ok(Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 64 * 1024 * 1024, "invalid lint input size");
    assert.ok(typeof value.sha256 === "string" && value.sha256.length === 64 && [...value.sha256].every(character => "0123456789abcdef".includes(character)), "unbound lint input");
  }
  fields(inventory, ["version", "records"]);
  assert.equal(inventory.version, 1, "unsupported lint inventory version");
  assert.ok(Array.isArray(inventory.records) && inventory.records.length > 0 && inventory.records.length <= 2000, "invalid lint records");
  const ids = new Set();
  const owners = new Map();
  const ownerAliases = new Map();
  const members = new Map();
  const symlinks = new Map();
  const aliases = new Map();
  let retirement;
  const retirementPaths = new Set();
  for (const record of inventory.records) {
    fields(record, ["id", "role", "owners", "proof", "members"], ["codeDirectory", "symlinks"]);
    text(record.id);
    assert.ok(!ids.has(record.id), "duplicate lint record");
    ids.add(record.id);
    assert.ok(["immutable-source-capture", "immutable-harness-capture", "generated-negative", "controlled-executable-fixture", "controlled-prototype-source", "archived-operational-tooling"].includes(record.role), "unknown lint record role");
    assert.ok(Array.isArray(record.owners) && record.owners.length > 0 && record.owners.length <= 64, "invalid lint owners");
    assert.ok(Array.isArray(record.members), "invalid lint members");
    assert.ok(record.symlinks === undefined || Array.isArray(record.symlinks), "invalid lint symlinks");
    assert.ok(record.members.length + (record.symlinks?.length ?? 0) > 0, "empty lint record");
    const localOwners = new Set();
    for (const owner of record.owners) {
      binding(owner);
      assert.ok(!localOwners.has(owner.path.toLowerCase()), "duplicate lint owner or case alias");
      localOwners.add(owner.path.toLowerCase());
      if (ownerAliases.has(owner.path.toLowerCase())) assert.equal(ownerAliases.get(owner.path.toLowerCase()), owner.path, "lint owner case alias");
      ownerAliases.set(owner.path.toLowerCase(), owner.path);
      if (owners.has(owner.path)) assert.deepEqual(owners.get(owner.path), owner, "conflicting lint owner binding");
      owners.set(owner.path, owner);
    }
    fields(record.proof, ["owner", "selector", "pathBase", "relation"]);
    path(record.proof.owner);
    assert.ok(record.owners.some(owner => owner.path === record.proof.owner), "unbound lint proof owner");
    if (record.role === "controlled-executable-fixture") {
      assert.ok(record.codeDirectory !== undefined, "executable fixtures require an exact code census");
      assert.ok(record.proof.owner.endsWith(".json"), "executable fixture proof requires a JSON owner");
      assert.ok(Array.isArray(record.proof.selector) && record.proof.selector.length === record.members.length, "executable fixture selectors must match members");
      assert.equal(new Set(record.proof.selector).size, record.proof.selector.length, "duplicate executable fixture selector");
      for (const selector of record.proof.selector) {
        text(selector);
        const index = Number(selector.slice(7));
        assert.ok(Number.isSafeInteger(index) && index >= 0 && selector === `/files/${index}`, "invalid executable fixture selector");
      }
    } else if (record.role === "archived-operational-tooling" && record.id === importRetirementId) {
      assert.equal(record.proof.selector, "/files", "retirement selector changed");
    } else if (record.role === "archived-operational-tooling") {
      assert.ok(Array.isArray(record.proof.selector), "archived tooling requires literal map selectors");
    } else text(record.proof.selector);
    if (record.id === importRetirementId || record.proof.owner === importRetirementOwner.path || record.owners.some(owner => owner.path === importRetirementOwner.path) || record.proof.relation === "root-named-import-origin-retirement-v1") {
      assert.equal(record.id, importRetirementId, "unapproved import-origin retirement");
      assert.equal(record.role, "archived-operational-tooling", "retirement operational role changed");
      assert.deepEqual(record.owners, [importRetirementOwner], "retirement owner binding changed");
      assert.ok(importRetirementOwner.bytes <= 524288, "retirement owner exceeds its dedicated cap");
      assert.equal(record.proof.owner, importRetirementOwner.path, "retirement owner path changed");
      assert.equal(record.proof.selector, "/files", "retirement selector changed");
      assert.equal(record.proof.pathBase, ".", "retirement path base changed");
      assert.equal(record.proof.relation, "root-named-import-origin-retirement-v1", "retirement relation changed");
      assert.ok(record.codeDirectory === undefined && record.symlinks === undefined, "retirement cannot exclude directories or symlinks");
      const paths = record.members.map(member => member.path);
      assert.equal(paths.length, 752, "retirement requires exactly752 retained paths");
      assert.equal(createHash("sha256").update(JSON.stringify(paths)).digest("hex"), retainedImportRetirementPathsSha256, "retirement literal set changed");
      for (const path of paths) retirementPaths.add(path);
      retirement = record;
    } else if (record.role === "archived-operational-tooling" || record.id === "launcher-v3-retired-operational-tooling" || record.proof.owner === archivedLauncherBase + "/DRIVER.json" || record.members.some(member => archivedLauncherFiles.some(name => member.path === archivedLauncherBase + "/" + name))) {
      assert.equal(record.id, "launcher-v3-retired-operational-tooling", "unapproved operational retirement");
      assert.equal(record.role, "archived-operational-tooling", "archived tooling must retain its operational role");
      assert.equal(record.owners.length, 1, "archived tooling has one literal DRIVER owner");
      assert.equal(record.proof.owner, archivedLauncherBase + "/DRIVER.json", "archived tooling DRIVER changed");
      assert.equal(record.proof.pathBase, archivedLauncherBase, "archived tooling base changed");
      assert.deepEqual(record.members.map(member => member.path), archivedLauncherFiles.map(name => archivedLauncherBase + "/" + name), "archived tooling requires its exact28 member paths");
      assert.deepEqual(record.proof.selector, archivedLauncherFiles.map(name => "/files/" + name), "archived tooling selectors changed");
      assert.ok(record.codeDirectory === undefined && record.symlinks === undefined, "archived tooling cannot exclude directories or symlinks");
    }
    const successor = successorProofs.find(proof => proof.id === record.id);
    if (successor || record.id.startsWith("candidate7-") || record.role === "controlled-prototype-source" || successorProofs.some(proof => proof.owner === record.proof.owner || record.members.some(member => member.path === proof.member))) {
      assert.ok(successor, "unapproved lint successor");
      assert.equal(record.role, successor.role, "successor role changed");
      assert.equal(record.proof.owner, successor.owner, "successor owner changed");
      assert.equal(record.proof.selector, successor.selector, "successor selector changed");
      assert.equal(record.proof.pathBase, successor.pathBase, "successor proof base changed");
      assert.equal(record.members.length, 1, "successor requires one literal member");
      assert.equal(record.members[0].path, successor.member, "successor member changed");
      assert.ok(record.codeDirectory === undefined && record.symlinks === undefined, "successor cannot admit directories or symlinks");
    }
    text(record.proof.relation);
    if (record.proof.pathBase !== ".") path(record.proof.pathBase);
    if (record.codeDirectory !== undefined) {
      path(record.codeDirectory);
      validatePath(record.codeDirectory, record.codeDirectory.startsWith("benchmarks/") ? "benchmarks" : "tests");
      assert.ok(record.proof.pathBase === "." || record.codeDirectory === record.proof.pathBase || record.codeDirectory.startsWith(`${record.proof.pathBase}/`), "lint census escapes proof base");
    }
    for (const member of record.members) binding(member);
    for (const link of record.symlinks ?? []) {
      fields(link, ["path", "target"]);
      path(link.path);
      text(link.target);
      assert.equal(record.role, "generated-negative", "symlinks require a generated-negative role");
    }
    for (const member of [...record.members, ...(record.symlinks ?? [])]) {
      validatePath(member.path, member.path.startsWith("benchmarks/") ? "benchmarks" : "tests");
      assert.ok(record.proof.pathBase === "." || member.path.startsWith(`${record.proof.pathBase}/`), "lint member escapes proof base");
      assert.ok(record.codeDirectory === undefined || member.path.startsWith(`${record.codeDirectory}/`), "lint member escapes code directory");
      assert.ok(!aliases.has(member.path.toLowerCase()), "duplicate lint member or case alias");
      aliases.set(member.path.toLowerCase(), member.path);
      (Object.hasOwn(member, "target") ? symlinks : members).set(member.path, member);
    }
  }
  assert.ok(members.size + symlinks.size <= 10000, "lint inventory exceeds member budget");
  for (const [path, owner] of owners) {
    assert.ok(!successorProofs.some(proof => proof.member === path), "successor subject cannot be a provenance owner before selector admission");
    if (!aliases.has(path.toLowerCase())) continue;
    assert.equal(aliases.get(path.toLowerCase()), path, "lint provenance owner/member case alias");
    const capture = inventory.records.find(record => record.members.some(member => member.path === path));
    const retiredProvenance = capture === retirement && importRetirementProvenanceOwners.includes(path);
    assert.ok(capture && (retiredProvenance || ["immutable-source-capture", "immutable-harness-capture"].includes(capture.role)) && !capture.owners.some(candidate => candidate.path === path), "lint producer/provenance owner requires an independent immutable record");
    assert.deepEqual(owner, members.get(path), "lint provenance member binding conflict");
  }
  function metadata(path) {
    assertAdmittedInputPath(path, boundaries);
    function validateSegment(entryPath, stat) {
      if (symlinks.has(entryPath)) assert.ok(stat.isSymbolicLink(), `lint negative fixture must remain a symlink: ${entryPath}`);
      if (members.has(entryPath)) assert.ok(stat.isFile(), `lint census member must remain a regular file: ${entryPath}`);
      if (entryPath !== path) assert.ok(stat.isDirectory(), `lint input ancestor must be a regular directory: ${path}`);
    }
    if (fileSystem.inspectAdmittedInput !== undefined) {
      assert.equal(typeof fileSystem.inspectAdmittedInput, "function", "invalid guarded inspection capability");
      const prefix = root + (root.endsWith("/") ? "" : "/");
      return fileSystem.inspectAdmittedInput(prefix + path, (absolute, stat) => {
        if (absolute.startsWith(prefix)) validateSegment(absolute.slice(prefix.length), stat);
      }).stat;
    }
    let directory = root;
    const parts = path.split("/");
    for (const [index, part] of parts.entries()) {
      const names = fileSystem.readdirSync(directory);
      assert.ok(names.includes(part), `nonliteral lint input: ${path}`);
      if (retirementPaths.has(path) || path === importRetirementOwner.path) assert.equal(names.filter(name => name.toLowerCase() === part.toLowerCase()).length, 1, `retirement path case alias: ${path}`);
      directory = join(directory, part);
      const stat = fileSystem.lstatSync(directory);
      const entryPath = parts.slice(0, index + 1).join("/");
      validateSegment(entryPath, stat);
      if (index === parts.length - 1) return stat;
    }
  }
  let inputBytes = 0;
  function authenticate(entry) {
    const stat = metadata(entry.path);
    assert.ok(stat.isFile(), `lint input must be a regular file: ${entry.path}`);
    if (retirementPaths.has(entry.path) || entry.path === importRetirementOwner.path) assert.equal(stat.nlink, 1, `retirement input must be single-link: ${entry.path}`);
    assert.equal(stat.size, entry.bytes, `lint input size changed: ${entry.path}`);
    inputBytes += stat.size;
    assert.ok(inputBytes <= 256 * 1024 * 1024, "lint input byte budget exceeded");
    const bytes = readRegularInput(root, entry.path, entry.bytes, fileSystem, boundaries);
    assert.equal(bytes.length, entry.bytes, `lint input size changed: ${entry.path}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `lint input changed: ${entry.path}`);
    return bytes;
  }
  const subjectOwners = new Set(inventory.records.filter(record => ["controlled-executable-fixture", "archived-operational-tooling"].includes(record.role)).map(record => record.proof.owner));
  const successors = inventory.records.filter(record => successorProofs.some(proof => proof.id === record.id));
  for (const record of successors) for (const owner of record.owners) if (owner.path.endsWith(".json")) subjectOwners.add(owner.path);
  const subjectManifests = new Map();
  if (retirement) {
    const receipt = JSON.parse(authenticate(importRetirementOwner));
    validateImportRetirement(retirement, receipt, boundaries);
    subjectManifests.set(importRetirementOwner.path, receipt);
  }
  for (const owner of owners.values()) {
    if (subjectManifests.has(owner.path)) continue;
    const bytes = authenticate(owner);
    if (subjectOwners.has(owner.path)) subjectManifests.set(owner.path, JSON.parse(bytes));
  }
  for (const record of inventory.records) if (record.role === "controlled-executable-fixture") {
    const manifest = subjectManifests.get(record.proof.owner);
    assert.ok(manifest && Array.isArray(manifest.files), "executable fixture owner requires files rows");
    for (const [index, member] of record.members.entries()) {
      const selected = manifest.files[Number(record.proof.selector[index].slice(7))];
      assert.ok(selected && typeof selected === "object" && !Array.isArray(selected), "missing executable fixture owner row");
      assertLiteralInputPath(selected.path);
      const selectedPath = record.proof.pathBase === "." ? selected.path : `${record.proof.pathBase}/${selected.path}`;
      path(selectedPath);
      assert.deepEqual({ path: selectedPath, bytes: selected.bytes, sha256: selected.sha256 }, member, "executable fixture owner row does not bind exact member");
    }
  }
  const historicalRoot = "/Users/kjopek/Workspace/safe-bash/";
  function manifest(path) {
    const value = subjectManifests.get(path);
    assert.ok(value && typeof value === "object" && !Array.isArray(value), "successor requires a bound JSON object");
    return value;
  }
  function boundRow(row, member, expectedPath, sizeField) {
    fields(row, ["path", sizeField, "sha256"], ["mode"]);
    assert.equal(row.path, expectedPath, "successor owner row path mismatch");
    assert.equal(row[sizeField], member.bytes, "successor owner row size mismatch");
    assert.equal(row.sha256, member.sha256, "successor owner row hash mismatch");
    if (Object.hasOwn(row, "mode")) assert.ok(Number.isSafeInteger(row.mode) && row.mode >= 0 && row.mode <= 0o7777, "invalid recorded mode");
  }
  for (const record of successors) {
    const proof = successorProofs.find(proof => proof.id === record.id);
    const member = record.members[0];
    const owner = manifest(proof.owner);
    if (record.role === "controlled-prototype-source") {
      assert.ok(owner.source && typeof owner.source === "object" && !Array.isArray(owner.source), "prototype requires a source map");
      assert.ok(Object.hasOwn(owner.source, member.path), "prototype source pointer missing");
      assert.equal(owner.source[member.path], member.sha256, "prototype source binding mismatch");
      const audit = manifest("tests/stress/regex-execution/design/validation/evidence/audit.json");
      assert.ok(audit.sourceHashes && typeof audit.sourceHashes === "object" && !Array.isArray(audit.sourceHashes) && Object.hasOwn(audit.sourceHashes, member.path), "prototype validation pointer missing");
      assert.equal(audit.sourceHashes[member.path], member.sha256, "prototype validation binding mismatch");
      continue;
    }
    const [collection, index] = proof.selector.slice(1).split("/");
    assert.ok(Array.isArray(owner[collection]), "successor requires declared owner rows");
    const expectedPath = proof.historical ? historicalRoot + member.path : proof.pathBase === "." ? member.path : member.path.slice(proof.pathBase.length + 1);
    boundRow(owner[collection][Number(index)], member, expectedPath, proof.sizeField);
    assert.equal(owner[collection].filter(row => row?.path === expectedPath).length, 1, "duplicate successor owner row");
    if (record.id !== "candidate7-07-content-binding-refusal") continue;
    const base = "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1";
    const closure = base + "/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1";
    const positive = owners.get(closure + "/ACTUAL-01/work/emitted/matcher.js");
    const runner = owners.get(closure + "/runner.mjs");
    const seal = owners.get(closure + "/SEAL.json");
    assert.ok(positive && runner && seal, "refusal must retain positive and binder owners");
    const positivePath = historicalRoot + positive.path;
    boundRow(owner.emittedBindings?.[5], positive, positivePath, "size");
    assert.deepEqual(owner.finalCensus[6], owner.emittedBindings[5], "restored positive binding changed");
    assert.equal(owner.finalCensus[0].mode, 0o644, "recorded refusal operand mode changed");
    assert.equal(owner.emittedBindings[5].mode, 0o644, "recorded positive operand mode changed");
    assert.notEqual(member.bytes, positive.bytes, "historical refusal changed both size and hash");
    assert.notEqual(member.sha256, positive.sha256, "historical refusal changed both size and hash");
    boundRow(manifest(seal.path).fixtures?.[7], runner, historicalRoot + runner.path, "size");
    const presealPath = base + "/FINAL-PRESEAL.json";
    const preseal = manifest(presealPath);
    boundRow(preseal.runner, runner, historicalRoot + runner.path, "size");
    boundRow(preseal.seal, seal, historicalRoot + seal.path, "size");
    const summaryPath = base + "/FINAL-RESULT.json";
    const summary = manifest(summaryPath);
    const finalSeal = manifest(base + "/FINAL-SEAL.json");
    assert.equal(summary.result?.sourceResult, historicalRoot + proof.owner, "refusal raw result path changed");
    assert.equal(summary.result?.resultSha256, owners.get(proof.owner).sha256, "refusal raw result digest changed");
    assert.equal(finalSeal.productResultSha256, owners.get(proof.owner).sha256, "refusal final result digest changed");
    boundRow(finalSeal.rows?.[1], owners.get(summaryPath), "FINAL-RESULT.json", "bytes");
    boundRow(finalSeal.rows?.[3], owners.get(presealPath), "FINAL-PRESEAL.json", "bytes");
    const guard = owner.guards?.[0];
    fields(guard, ["id", "refused", "reason", "dataOnly"]);
    assert.equal(guard.id, "B01-content", "refusal is a content binding control");
    assert.equal(guard.refused, true, "refusal result changed");
    assert.equal(guard.dataOnly, true, "refusal operand is data only");
    const reason = [
      "AssertionError [ERR_ASSERTION]: SAFETY input binding", "+ actual - expected", "", "  {", "    mode: 420,",
      "    path: '" + expectedPath + "',", "+   sha256: '" + member.sha256 + "',", "+   size: " + member.bytes,
      "-   sha256: '" + positive.sha256 + "',", "-   size: " + positive.bytes, "  }", "",
    ].join("\n");
    assert.equal(guard.reason, reason, "refusal expected and actual operands changed");
    assert.deepEqual(summary.guards?.[0], guard, "refusal summary guard changed");
    for (const [index, role] of [[19, "M01-old-reporting-restored"], [21, "M02-history-link-restored"], [23, "M03-reset-checkpoint-restored"], [25, "M04-reset-precharge-restored"]]) {
      const row = owner.rows?.[index];
      assert.equal(row?.role, role, "restored row identity changed");
      assert.equal(row.mutated, false, "restored row still mutated");
      assert.equal(row.observed?.fail, 0, "restored row failure changed");
      assert.deepEqual(row.loaded?.files?.matcher, { [index === 21 ? "url" : "path"]: (index === 21 ? "file://" : "") + positivePath, sha256: positive.sha256 }, "restored matcher identity changed");
    }
  }
  for (const record of inventory.records) if (record.role === "archived-operational-tooling" && record.id !== importRetirementId) {
    const driver = manifest(record.proof.owner);
    assert.equal(driver.schema, 1, "archived DRIVER schema changed");
    assert.equal(driver.candidate, "f5e9fc49b6abb38e180cc9de16c95fced102ff75", "archived candidate changed");
    assert.equal(driver.wholeGateLaunched, false, "archived launch qualification changed");
    assert.ok(driver.files && typeof driver.files === "object" && !Array.isArray(driver.files), "archived DRIVER requires an own file map");
    assert.deepEqual(Object.keys(driver.files).sort(), [...archivedLauncherFiles, ...archivedLauncherOtherFiles].sort(), "archived DRIVER must retain its exact40 names");
    for (const digest of Object.values(driver.files)) assert.ok(typeof digest === "string" && digest.length === 64 && [...digest].every(character => "0123456789abcdef".includes(character)), "invalid archived DRIVER digest");
    for (const [index, member] of record.members.entries()) {
      const name = archivedLauncherFiles[index];
      assert.ok(Object.hasOwn(driver.files, name), "archived DRIVER pointer missing");
      assert.equal(driver.files[name], member.sha256, "archived DRIVER pointer does not bind member");
    }
  }
  let censusEntries = 0;
  function visit(path) {
    assert.ok(++censusEntries <= 20000, "lint code census exceeds entry budget");
    const stat = metadata(path);
    if (stat.isDirectory()) {
      for (const name of fileSystem.readdirSync(join(root, path))) visit(`${path}/${name}`);
    } else if (stat.isSymbolicLink()) {
      assert.ok(symlinks.has(path), `unbound lint census symlink: ${path}`);
    } else {
      assert.ok(stat.isFile(), `special file in lint code census: ${path}`);
      if ([".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"].some(extension => path.endsWith(extension))) {
        assert.ok(members.has(path), `unbound code in lint census: ${path}`);
      }
    }
  }
  for (const record of inventory.records) if (record.codeDirectory !== undefined) {
    assert.ok(metadata(record.codeDirectory).isDirectory(), "lint code census requires a regular directory");
    visit(record.codeDirectory);
  }
  for (const link of symlinks.values()) {
    assert.ok(metadata(link.path).isSymbolicLink(), `lint negative fixture must remain a symlink: ${link.path}`);
    assert.equal(fileSystem.readlinkSync(join(root, link.path)), link.target, `lint symlink target changed: ${link.path}`);
  }
  for (const member of members.values()) authenticate(member);
  return { files: [...members.keys(), ...symlinks.keys()], records: inventory.records };
}

export function readIntegrationLintInputs(root, boundaries, fileSystem = fs) {
  const path = "integration-lint-inventory.json";
  const expectedBytes = 535875;
  const bytes = readRegularInput(root, path, expectedBytes, {
    ...fileSystem,
    lstatSync(filename) {
      const stat = fileSystem.lstatSync(filename);
      if (filename === join(root, path)) assert.equal(stat.size, expectedBytes, "unapproved lint inventory size");
      return stat;
    },
  }, boundaries);
  assert.equal(bytes.length, expectedBytes, "unapproved lint inventory size");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "c67f5004c29e0974e166fc007e794e1ae35083a017a1c96b6e60cb79b59c6689", "unapproved integration lint inventory");
  return verifyLintInventory(root, JSON.parse(bytes), boundaries, fileSystem);
}

export function lintExclusions(root, boundaries, fileSystem = fs) {
  const inventories = readTypecheckInventories(root, boundaries, fileSystem);
  return {
    files: [
      ...boundaries.heldSourceFiles,
      ...readIntegrationTypeInputs(root, boundaries, fileSystem).entries.map(entry => entry.path),
      ...readIntegrationLintInputs(root, boundaries, fileSystem).files,
      "tests/commands/table-text-stress/shared-stdin-review/selected-gnu.ts",
      ...inventories.paths,
    ],
    directories: [nativeData, ...boundaries.heldEvidenceDirectories, ...boundaries.fixtureDirectories.map(fixture => fixture.path)],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  const build = JSON.parse(readRegularInput(root, "tsconfig.build.json", 300000));
  const heldCode = boundaries.heldSourceFiles.filter(path => path.endsWith(".ts"));
  assert.deepEqual(build.exclude.filter(path => path.startsWith("src/commands/xan/")), heldCode);
  const heldDirectory = "src/commands/xan";
  const paths = fs.readdirSync(join(root, heldDirectory), { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isDirectory() || boundaries.heldEvidenceDirectories.includes(`${heldDirectory}/${entry.name}`), `unclassified held source directory: ${entry.name}`);
    return [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].some(extension => entry.name.endsWith(extension)) ? [`${heldDirectory}/${entry.name}`] : [];
  });
  assert.deepEqual(paths.sort(), [...heldCode].sort(), "held source inventory changed; classify paths before reading contents");
}
