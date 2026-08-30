import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function read(filename, expected, maximum = 2097152) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  if (expected) assert.equal(stat.size, expected.bytes);
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.length, stat.size);
  if (expected) assert.equal(sha(bytes), expected.sha256);
  return bytes;
}
function write(name, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  assert.ok(bytes.length <= 4194304);
  fs.writeFileSync(path.join(root, name), bytes, { flag: "wx", mode: 0o600 });
  return { bytes: bytes.length, sha256: sha(bytes) };
}
const preseal = JSON.parse(read(path.join(root, "PREP-PRESEAL.json")));
assert.ok(Date.now() < Date.parse(preseal.deadline));
for (const row of preseal.inputs) read(path.join(root, row.path), row, 4194304);
const stage = path.join(root, "staged");
const frozen = JSON.parse(read(path.join(stage, "metadata/FROZEN-BINDINGS.json")));
const recipe = JSON.parse(read(path.join(stage, "metadata/RECIPE.json")));
const originals = JSON.parse(read(path.join(root, "origins/preserved/ORIGINS.json")));
const slots = JSON.parse(read(path.join(root, "origins/preserved/RETAINED-672.json")));
assert.equal(frozen.selectedTree, "3adc676a0ab638c9788ef007e465931d65d2c6fe");
assert.equal(frozen.selectedInputs.length, 309);
assert.equal(frozen.actualEmitted.length, 1012);
assert.equal(frozen.packageMembers.length, 1014);
assert.equal(slots.slots.length, 672);
assert.equal(recipe.roles.length, 41);
assert.equal(recipe.roles.filter(row => row.script).length, 34);
const mapping = slots.slots.map(row => {
  const stagedPath = row.stagedHarness.replace(/^runtime\//, "legacy/");
  read(path.join(stage, stagedPath), row.harnessOrigin);
  return { slot: row.slot, originalId: row.originalId, layout: row.layout, stagedPath, origin: row.harnessOrigin, status: "UNRUN" };
});
for (const role of recipe.roles.filter(row => row.kind === "retained")) {
  const selected = mapping.filter(row => row.layout === role.layout && path.basename(row.stagedPath) === role.script);
  assert.deepEqual(selected.map(row => row.originalId), role.ids);
}
for (const row of originals.entries) {
  const name = row.stagedPath.replace(/^runtime\//, "legacy/");
  if (fs.existsSync(path.join(stage, name))) read(path.join(stage, name), row.origin);
}
read(path.join(stage, "legacy/harness/conditional.mjs"), { bytes: 14524, sha256: "0c8216e79aeaadd22bededaf2cc72a8daf83e296584c4b31efa2fed0b5c917e7" });
const consumed = [];
function consume(filename, row, maximum) {
  read(filename, row, maximum);
  consumed.push({ filename, bytes: row.bytes, sha256: row.sha256 });
}
consume(frozen.compressedPackage.path, frozen.compressedPackage);
const sourceRoot = "/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source";
for (const name of ["src/commands/regex-execution/client.ts", "src/shell/conditional.ts", "src/plugins/agent-commands.ts"]) {
  const row = frozen.selectedInputs.find(item => item.path === name);
  if (!row && name === "src/plugins/agent-commands.ts") continue;
  assert.ok(row, name);
  consume(path.join(sourceRoot, row.path), row);
}
for (const mutation of recipe.mutations) {
  const row = frozen.packageMembers.find(item => item.path === `dist/${mutation.file}`);
  const bytes = read(path.join(sourceRoot, row.path), row);
  assert.equal(bytes.toString().split(mutation.before).length, 2);
  assert.equal(sha(Buffer.from(bytes.toString().replace(mutation.before, mutation.after))), mutation.prospectiveMutantSha256);
  assert.equal(sha(bytes), mutation.restoreExpectedSha256);
  consumed.push({ filename: path.join(sourceRoot, row.path), bytes: row.bytes, sha256: row.sha256 });
}
const client = read(path.join(sourceRoot, "src/commands/regex-execution/client.ts"), frozen.selectedInputs.find(row => row.path === "src/commands/regex-execution/client.ts")).toString();
assert.ok(client.includes("private readonly slots = new Set<Slot>();"));
assert.ok(client.includes("constructor(options: RegexExecutionOptions = defaults) { this.options = policy(options); }"));
const conditional = read(path.join(sourceRoot, "src/shell/conditional.ts"), frozen.selectedInputs.find(row => row.path === "src/shell/conditional.ts")).toString();
assert.ok(!/Worker|RegexExecutor|regex-execution/.test(conditional));
for (const row of recipe.regexClosure.fixtureRoots) read(path.join(stage, row.file.replace(/^runtime\//, "legacy/")), row);
const files = [];
function walk(directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) walk(filename);
    else {
      const bytes = read(filename);
      files.push({ path: path.relative(stage, filename), bytes: bytes.length, sha256: sha(bytes) });
    }
  }
}
walk(stage);
const edges = [];
for (const row of files.filter(item => item.path.endsWith(".mjs"))) {
  const text = read(path.join(stage, row.path), row).toString();
  for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith(".")) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(row.path), specifier));
      assert.ok(files.some(item => item.path === resolved), `${row.path} -> ${resolved}`);
      edges.push({ importer: row.path, specifier, resolved });
    } else assert.ok(specifier.startsWith("node:") || specifier === "virtual-bash", specifier);
  }
}
write("SOURCE-QUALIFICATION.json", { consumed, freshPackageHashBeforeDecode: true, decodeCalls: 0, staticEdges: edges, regexClosure: recipe.regexClosure, fixtureOrigins: mapping, sourceRecensus: false, historicalOrigin: "2660137c4af1c58362e42ae2950f43635071a714", authority: "Preserved 881ed898 records, with per-fixture originalPath/blob retained; not current HEAD" });
const packet = { schema: "B2_EXECUTABLE_PACKET_R6", source: frozen.selectedTree, package: frozen.compressedPackage, files, roleCount: 41, retained: 672, runtime: "UNRUN", rootAuthority: "PENDING", independentReview: "PENDING", computedImports: [{ importer: "new/outer.mjs", target: "new/coordinator.mjs", constraint: "literal after packet authentication" }, { importer: "new/loader.mjs", constraint: "file URLs must match per-role members; every supplied JS source hashed; node builtins trusted host" }], knownRoleGraph: { totalMaximum: 64, peak: 3, entry: 1, supervised: 41, administrationPublicationMaximum: 22, administration: { bindingAndFreshness: 6, inspectionAndCapture: 4, evidencePublication: 6, scopedGit: 6 }, entryExecReplacementNotExtraStart: true, guestWorkers: 0, regexWorkers: 0, mainLoaderAdmissions: 34, mainLoaderPeak: 1, qualification: "Known roles only; no universal transitive OS/thread census or individual async-loader exit proof" } };
const identity = write("staged/PACKET.json", packet);
write("PACKET-SEAL.json", { ...identity, path: "staged/PACKET.json", files: files.length, controls: "PENDING", runtime: "UNRUN" });
console.log(JSON.stringify({ status: "PACKET_MATERIALIZED", identity, files: files.length, retained: 672, roles: 41, consumedPins: consumed.length, relativeEdges: edges.length, runtimeImports: 0 }));
