import assert from "node:assert/strict";
import { readFileSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { blob, entries, git, guard, inventory, json, objectId, sha256, streamBlob, validateLinkBytes, validateTree } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../../..");
guard(process.argv.length === 3, "CLI", "bind.mjs NEW_OUTPUT_DIRECTORY");
const output = resolve(process.argv[2]);
mkdirSync(output);
const candidate = "aff899aa94ed0c57a936b08fd36d185688f5c0bb";
const tree = "9641374115db435022ac172ec9c99d305e07dbe4";
const author = "9dc858c81672ff52b56d25f174d04714906cdff5";
const source = "28cf1518eb3e1a27c5439ba89ff1801e3f852c3b";
const freeze = "54f1e4d819e0d3cde422c1f305a84474932e3bac";
const module = "9ae34a06662db27897043d77d6145700c109b22c";
const authorPrefix = "tests/plugins/html-to-markdown-public-author/";
const fixturePrefix = "tests/integration/html-public-independent-20260827/";
const reads = [];
function read(commit, path, purpose) {
  const matches = entries(repository, commit, [path]).filter(entry => entry.path === path);
  guard(matches.length === 1, "BINDING_PATH", path);
  const entry = matches[0], bytes = blob(repository, entry);
  reads.push({ sequence: reads.length + 1, at: new Date().toISOString(), commit, ...entry, sha256: sha256(bytes), bytes: bytes.length, purpose });
  return bytes;
}
json(join(output, "PRE.json"), { at: new Date().toISOString(), scope: "hash-only Git binding; no candidate compiler/npm/runtime execution", harness: inventory(here), node: { path: realpathSync(process.execPath), sha256: sha256(readFileSync(realpathSync(process.execPath))) }, git: { path: "/usr/bin/git", sha256: sha256(readFileSync("/usr/bin/git")) } });
try {
  const receiptRaw = read(author, `${authorPrefix}evidence-v1/INDEPENDENT-BINDINGS-BLOCKED.json`, "exact root receipt, parsed");
  guard(sha256(receiptRaw) === "f4abf562b80e31c1c43962ffc84820c6df8ea443e924adf693f238fca8e764d0", "RECEIPT_HASH");
  const receipt = JSON.parse(receiptRaw);
  const parentReadme = read(author, `${authorPrefix}README.md`, "exact receipt parent README, read");
  writeFileSync(join(output, "author-parent-README.raw"), parentReadme, { flag: "wx" });
  writeFileSync(join(output, "receipt.json.gz.base64"), `${gzipSync(receiptRaw).toString("base64")}\n`, { flag: "wx" });
  assert.equal(receipt.candidateCommit, candidate);
  assert.equal(receipt.fixtureCommit, freeze);
  assert.equal(git(repository, ["rev-parse", `${candidate}^{tree}`]).toString().trim(), tree);
  const manifest = JSON.parse(read(author, `${authorPrefix}evidence-v1/MANIFEST.json`, "author capture authentication"));
  const compressed = Buffer.from(read(author, `${authorPrefix}evidence-v1/RAW.json.gz.base64`, "decode immutable capture; no captured program executed").toString(), "base64");
  assert.equal(sha256(compressed), manifest.compressedSha256);
  const payload = gunzipSync(compressed, { maxOutputLength: 16 * 1024 ** 2 });
  assert.equal(sha256(payload), manifest.payloadSha256);
  assert.equal(payload.length, manifest.payloadBytes);
  const captures = JSON.parse(payload).entries;
  assert.equal(captures.length, 52);
  for (const entry of captures) {
    const declared = manifest.entries.find(value => value.name === entry.name);
    assert.ok(declared);
    const bytes = Buffer.from(entry.base64, "base64");
    assert.equal(bytes.length, declared.bytes);
    assert.equal(sha256(bytes), declared.sha256);
  }
  const reportEntry = captures.find(entry => entry.name === "final/REPORT.json");
  const reportBytes = Buffer.from(reportEntry.base64, "base64"), report = JSON.parse(reportBytes);
  writeFileSync(join(output, "author-report.json.gz.base64"), `${gzipSync(reportBytes).toString("base64")}\n`, { flag: "wx" });
  assert.equal(report.candidate, candidate);
  assert.equal(report.tree, tree);
  const inputs = report.inputBindings;
  assert.equal(inputs.length, 410);
  const authorEnvelope = inputs.filter(entry => entry.path.startsWith("src/") || ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md"].includes(entry.path));
  assert.equal(sha256(JSON.stringify(authorEnvelope)), report.buildInputsSha256);
  assert.equal(report.buildInputsSha256, "0e7342e1dce75b2bce4c7501fd308e6d263845630bb8fa6372ed6d632aeec6eb");
  const fullTree = entries(repository, candidate);
  const links = Object.fromEntries(Object.entries(receipt.archiveSymlinks).map(([path, entry]) => [path, { ...entry, mode: "120000", targetBase64: Buffer.from(entry.target).toString("base64") }]));
  assert.equal(Object.keys(links).length, 12);
  validateTree(fullTree, links, inputs);
  assert.deepEqual(fullTree.filter(entry => entry.mode !== "120000").map(entry => entry.path).sort(), Object.keys(receipt.packageFiles).sort());
  for (const entry of fullTree.filter(entry => entry.mode === "120000")) validateLinkBytes(entry, links[entry.path], blob(repository, entry));
  for (const entry of inputs) {
    await streamBlob(repository, entry);
    assert.equal(entry.sha256, receipt.packageFiles[entry.path]);
  }
  assert.deepEqual(fullTree.filter(entry => entry.path.startsWith("src/")), inputs.filter(entry => entry.path.startsWith("src/")).map(({ sha256: unused, ...entry }) => entry));
  const html = [];
  for (const entry of fullTree.filter(entry => entry.path.startsWith("src/commands/html-to-markdown/") && entry.path.endsWith(".ts"))) {
    const acceptedCommit = entry.path.endsWith("/index.ts") ? source : module;
    const accepted = read(acceptedCommit, entry.path, "HTML byte identity; index bound to source/export, all seven non-index TS inputs bound to9ae");
    const bytes = blob(repository, entry);
    assert.deepEqual(bytes, accepted);
    html.push({ ...entry, sha256: sha256(bytes), acceptedCommit });
  }
  assert.equal(html.find(entry => entry.path.endsWith("/render.ts")).sha256, receipt.rendererSha256);
  for (const path of ["README.md", "package.json", "src/index.ts", "src/plugins/index.ts", "src/commands/html-to-markdown/README.md"]) {
    const bytes = read(source, path, "source/export identity against candidate");
    assert.equal(objectId("blob", bytes), fullTree.find(entry => entry.path === path).blob);
  }
  const fixtures = [];
  for (const entry of entries(repository, freeze).filter(entry => entry.path.startsWith(fixturePrefix))) {
    const bytes = read(freeze, entry.path, "frozen original file from Git; behavioral expectations not amended");
    assert.deepEqual(readFileSync(join(repository, entry.path)), bytes);
    fixtures.push({ ...entry, sha256: sha256(bytes) });
  }
  assert.equal(fixtures.length, 18);
  const tools = {};
  for (const name of ["node", "npm", "tsc"]) {
    const path = realpathSync(receipt.toolPaths[name]);
    const hash = sha256(readFileSync(path));
    assert.equal(hash, receipt.toolExecutables[name]);
    tools[name] = { path, sha256: hash };
  }
  for (const name of ["typescript", "nodeTypes", "undiciTypes", "npmRoot"]) {
    const path = realpathSync(receipt.toolPaths[name]);
    const files = inventory(path), hash = sha256(JSON.stringify(files));
    assert.equal(hash, receipt.toolTrees[name]);
    tools[name] = { path, sha256: hash, files: Object.keys(files).length };
  }
  const commitRaw = git(repository, ["cat-file", "commit", candidate]);
  assert.equal(objectId("commit", commitRaw), candidate);
  writeFileSync(join(output, "candidate.commit.raw"), commitRaw, { flag: "wx" });
  const parent = commitRaw.toString().split("\n").find(line => line.startsWith("parent ")).slice(7);
  git(repository, ["merge-base", "--is-ancestor", parent, author]);
  git(repository, ["merge-base", "--is-ancestor", candidate, author]);
  const deltaPaths = git(repository, ["diff", "--name-only", "-z", parent, candidate]).toString().split("\0").filter(Boolean);
  const authorEntries = new Map(entries(repository, author).map(entry => [entry.path, entry]));
  const delta = deltaPaths.map(path => {
    const entry = fullTree.find(value => value.path === path);
    assert.deepEqual(authorEntries.get(path), entry);
    return { ...entry, sourceCommit: author, sha256: sha256(blob(repository, entry)) };
  });
  assert.equal(delta.length, 2);
  const binding = {
    schema: "html-admission-v2/1", at: new Date().toISOString(), candidate, tree, source, author, freeze, module,
    receipt: reads[0], report: { rawSha256: sha256(reportBytes), sourceEntry: "final/REPORT.json", authorManifestPayloadSha256: manifest.payloadSha256 },
    archive: { bytes: 2340945920, sha256: receipt.archiveSha256, proof: "pristine full Git archive stream, not selected-input envelope" },
    pack: { sha256: receipt.packSha256, files: receipt.packFiles, count: 830, emittedCount: 828 },
    fullTree: { entries: fullTree.length, regularFiles: Object.keys(receipt.packageFiles).length, sha256: sha256(JSON.stringify(fullTree)), proof: "Git mode/blob/path metadata; individual historical regular SHA256 values remain receipt assertions until full archive stream hash matches" },
    inputs, all410InputsSha256: sha256(JSON.stringify(inputs)), buildInputsSha256: report.buildInputsSha256, authorEnvelopeCount: authorEnvelope.length, links, html, fixtures, tools,
    selectedRoots: ["src", "scripts", "package.json", "package-lock.json", "README.md", "tsconfig.json", "tsconfig.build.json", authorPrefix.slice(0, -1), "tests/commands/html-to-markdown", "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration", "tests/plugins/qualified-current-release", "tests/plugins/stream-five-public", "tests/integration/stream-inspection-public-author/consumer.mts"],
    durability: { rawCommitSha256: sha256(commitRaw), rawCommitBytes: commitRaw.length, parent, reachableAuthor: author, candidateReachableFromAuthor: true, delta, fourteenPathStatus: "NOT ESTABLISHED: receipt supplies six product paths, no14path reconstruction list; actual reachable direct-parent delta is2paths. Do not invent14. Candidate is itself reachable from9dc858c8." },
    originalRejection: { rawPresent: false, evidence: "All52 committed author raw entries authenticated; none is a frozen runner/declaration admission rejection log. Receipt and parent README report symlink rejection and1GiB buffer hazard. No unsafe historical runner replay performed.", authorCaptureNames: captures.map(entry => entry.name) },
    policy: { option: "htmlToMarkdown?: Omit<HtmlToMarkdownCommandsOptions, 'replace'>", replacement: "top-levelreplacewins", exactUserPolicy: "validatebeforeoperation; originalcallercontext/signalforrequiredstderr; input/conversion/stdout ownedopcleanup-beforeacquire+awaited. Callerabortexactreason. Directhandler REthrows exactoperation-close reason aftercleanup (notfakesuccess/141); existingShellEPIPE handling sets pipelinecode. Othercaughterrorskeepusage2/conversion-limit-FS1boundedstderr; closuredoesNOTreclassifyunrelatederror. No wholecallerabort/opaqueinputpreemption.", adoption: "separate binding only; no frozen expectation or lifecycle harness modification" },
    scope: "Admission compiler/npm proof only; zero34case runtime cohort executions; Raman review pending; HTML74fixed, DU75/expr76separate; no whole gate or public acceptance",
  };
  json(join(output, "BINDINGS.json"), binding);
  json(join(output, "READS.json"), { exploratoryChronology: ["Read applicable root/parent AGENTS and status/index before edits; no nested AGENTS found.", "Read exact author receipt/README and frozen run/contract/readme by Git, then authenticated decoded52-entry author capture.", "Inspected frozen source/export and module bytes only for identities; no candidate module execution.", "Read7f3ad2f5 provenance pattern; discovered actual aff candidate reachable from9dc and parent delta2, not14.", "Initial exploratory output accidentally printed oversized receipt and a large path delta; no archive materialized or candidate code executed; subsequent reads were bounded summaries."], reads });
  console.log(JSON.stringify({ output, candidate, inputs: inputs.length, links: Object.keys(links).length, fixtures: fixtures.length, bindingSha256: sha256(readFileSync(join(output, "BINDINGS.json"))) }));
} catch (error) {
  json(join(output, "FAILURE.json"), { at: new Date().toISOString(), message: error.message, stack: error.stack, reads });
  throw error;
}
