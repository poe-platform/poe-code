import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { admission, select } from "./policy-model.mjs";
import { controls } from "./control-inputs.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: owned, encoding: "utf8" }).trim();
const source = "21220b465537bf45ffcfb36740956a69f43bf75e";
const hash = value => createHash("sha256").update(value).digest("hex");
const readJson = async file => JSON.parse(await readFile(file, "utf8"));
const history = await readJson(join(owned, "HISTORICAL10.json"));
const freeze = await readJson(join(owned, "CONTROLS.json"));
const inputs = await readJson(join(owned, "SOURCE_INPUTS.json"));
const args = process.argv.slice(2);
assert(args.every(argument => ["--runtime", "--initial-capture"].includes(argument)), "unknown argument");
const initialCapture = args.includes("--initial-capture");
const manifestPath = join(owned, "MANIFEST.json");
const manifestExists = (await readdir(owned)).includes("MANIFEST.json");
if (initialCapture) assert(!manifestExists, "initial capture must never bypass an existing manifest");
else assert(manifestExists, "missing frozen manifest");

async function inventory(directory, prefix = "") {
  const files = [], directories = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      directories.push(name);
      const nested = await inventory(join(directory, entry.name), name);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else {
      assert(entry.isFile(), `unexpected non-regular entry ${name}`);
      files.push({ path: name, sha256: hash(await readFile(join(directory, entry.name))) });
    }
  }
  return { files, directories };
}

async function ownedInventory() {
  const result = await inventory(owned);
  return { ...result, files: result.files.filter(entry => entry.path !== "MANIFEST.json") };
}

const before = await ownedInventory();
if (!initialCapture) assert.deepEqual(before, (await readJson(manifestPath)).inventory, "owned freeze precheck");
const matrixBytes = execFileSync("git", ["show", `${history.source.commit}:${history.source.path}`], { cwd: root, maxBuffer: 8_000_000 });
assert.equal(hash(matrixBytes), history.source.sha256);
assert.equal(hash(await readFile(join(root, history.source.path))), history.source.sha256, "original matrix remains unchanged");
assert.deepEqual(history.rows, JSON.parse(matrixBytes).categories.namedLocale);
assert.equal(history.rows.length, 10);
assert(history.rows.every(row => row.comparison.semantic === false && row.comparison.strict === false));
assert.deepEqual(freeze, controls(), "control data matches its explicit authoring inputs");
const identifiers = [...freeze.selectors, ...freeze.rows].map(row => row.id);
assert.equal(new Set(identifiers).size, identifiers.length);
for (const row of freeze.selectors) assert.deepEqual({ character: select(row.env, "LC_CTYPE"), collation: select(row.env, "LC_COLLATE") }, row.expected, row.id);
for (const row of freeze.rows) assert.deepEqual(admission(row), row.expected, row.id);
for (const row of history.rows) {
  const operation = row.id === "unicode-collation" ? "string-comparison" : row.input.argv.includes(":") ? "match" : row.input.argv[0];
  const decision = admission({ operation, env: row.virtualInvocation.environment, pattern: row.input.pattern?.text });
  assert.equal(decision.decision, row.id === "unicode-collation" ? "refuse" : "allow", row.id);
}
assert(!/process\.env|Intl\.Collator/u.test(await readFile(join(owned, "policy-model.mjs"), "utf8")));

for (const input of inputs.files) {
  assert.equal(hash(execFileSync("git", ["show", `${source}:${input.path}`], { cwd: root })), input.sha256, input.path);
}

let runtime = null;
if (args.includes("--runtime")) {
  const scratch = await mkdtemp(join(owned, ".scratch-accepted-"));
  try {
    const archive = execFileSync("git", ["archive", source, "src", "package.json", "tsconfig.json", "tsconfig.build.json"], { cwd: root, maxBuffer: 16_000_000 });
    execFileSync("tar", ["-x", "-f", "-", "-C", scratch], { input: archive });
    const sourceBefore = await inventory(join(scratch, "src"));
    for (const input of inputs.files) assert.equal(hash(await readFile(join(scratch, input.path))), input.sha256, input.path);
    const build = execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(scratch, "tsconfig.build.json")], { cwd: scratch, encoding: "utf8", timeout: 120_000 });
    const experiments = [];
    for (const ambientLocale of ["en_US.UTF-8", "C"]) {
      const result = execFileSync(process.execPath, [join(owned, "runtime-driver.mjs"), scratch], {
        cwd: scratch, encoding: "utf8", timeout: 120_000, maxBuffer: 2_000_000,
        env: { PATH: "/usr/bin:/bin", LC_ALL: ambientLocale, LC_CTYPE: ambientLocale, LC_COLLATE: ambientLocale, LANG: ambientLocale },
      });
      experiments.push({ explicitHarnessAmbientLocale: ambientLocale, result: JSON.parse(result) });
    }
    assert.deepEqual(experiments[0].result, experiments[1].result, "ambient locale does not affect explicit command environments");
    assert.deepEqual(await inventory(join(scratch, "src")), sourceBefore, "accepted source including new entries unchanged");
    for (const input of inputs.files) assert.equal(hash(await readFile(join(scratch, input.path))), input.sha256, input.path);
    runtime = { archiveSha256: hash(archive), acceptedSource: source, node: process.version,
      typescript: execFileSync(join(root, "node_modules/.bin/tsc"), ["--version"], { encoding: "utf8" }).trim(),
      platform: process.platform, architecture: process.arch, buildOutput: build,
      sourceInventory: sourceBefore, experiments, sourcePostcheck: "complete src file/directory inventory and frozen config hashes unchanged" };
  } finally {
    assert.equal(dirname(scratch), owned);
    assert(relative(owned, scratch).startsWith(".scratch-accepted-"));
    await rm(scratch, { recursive: true, force: true });
  }
}
assert.deepEqual(await ownedInventory(), before, "owned pre/post complete file and directory inventory unchanged");
if (!initialCapture) assert.deepEqual(await ownedInventory(), (await readJson(manifestPath)).inventory, "owned freeze postcheck");
console.log(JSON.stringify({ schema: 1, kind: "explicit-design-verification-not-named-product-acceptance", acceptedSource: source,
  historicalMismatchesPreserved: 10, proposedScalarAdmissions: 9, continuedCollationRefusals: 1,
  selectorControls: freeze.selectors.length, admissionControls: freeze.rows.length,
  manifestMode: initialCapture ? "initial-capture-no-manifest-yet" : "complete-frozen-pre-and-post-inventory",
  originalMatrixSha256: history.source.sha256, runtime }, null, 2));
