import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const profile = "tests/commands/metadata-stress/permission-profile";
const destination = process.argv[2];
assert.ok(destination && /^author-[a-z0-9-]+$/u.test(destination), "supply a new author-* evidence directory name");
const output = `${profile}/${destination}`;
assert.equal(fs.existsSync(path.join(root, output)), false, "refuse to overwrite author evidence");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const ownedTests = ["tests/commands/metadata-stress/chmod-controls.test.ts", "tests/commands/metadata-stress/native-differential.test.ts",
  `${profile}/archive.test.ts`, `${profile}/qualification.test.ts`, `${profile}/darwin-profile.test.ts`, `${profile}/fixtures.ts`];
function inventory() {
  const records = {};
  function visit(relative) {
    const filename = path.join(root, relative);
    if (!fs.existsSync(filename)) return;
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) for (const name of fs.readdirSync(filename).sort()) visit(`${relative}/${name}`);
    else records[relative] = stat.isSymbolicLink() ? `link:${fs.readlinkSync(filename)}` : hash(fs.readFileSync(filename));
  }
  for (const name of ["src", "dist", "package.json", "package-lock.json", "tsconfig.json", "AGENTS.md", "tests/commands/metadata-stress/helpers.ts", ...ownedTests,
    `${profile}/PROPOSAL.md`, `${profile}/capture-author.mjs`, `${profile}/classification-seal`,
    "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod"]) visit(name);
  return { at: new Date().toISOString(), head: git(["rev-parse", "HEAD"]).trim(),
    status: git(["status", "--porcelain=v1"]), index: git(["diff", "--cached", "--name-status"]), records,
    digest: hash(JSON.stringify(records)) };
}
const originals = {};
const current = {};
for (const filename of ownedTests.slice(0, 2)) {
  originals[filename] = git(["show", `b494675c:${filename}`]);
  current[filename] = fs.readFileSync(path.join(root, filename), "utf8");
  let normalized = current[filename].replace('import { qualifyModeFixtures } from "./permission-profile/fixtures.js";\n', "");
  if (filename.endsWith("chmod-controls.test.ts")) {
    normalized = normalized.replace('  const qualified = await qualifyModeFixtures(root, ["directory"]);\n', "")
      .replace('    const measured = await qualified.setMode("directory", initial);',
        '    await host.chmod(join(root, "directory"), initial);\n    const measured = (await host.stat(join(root, "directory"))).mode & 0o7777;');
  } else {
    normalized = normalized.replace('  const qualified = await qualifyModeFixtures(root, ["file", "directory"]);\n', "")
      .replace('    await qualified.setMode(name, initial);', '    await host.chmod(join(root, name), initial);');
  }
  assert.equal(normalized, originals[filename], `unexpected non-precondition source change in ${filename}`);
}
const source = originals[ownedTests[1]];
const modes = JSON.parse(/const modes = (\[[^\n]+\]);/u.exec(source)[1]);
const masks = /const masks = \[([^\]]+)\]/u.exec(source)[1].split(",").map(value => Number(value.trim()));
let seed = Number(/let seed = (0x[0-9a-f]+);/u.exec(source)[1]);
const transitions = [];
for (let iteration = 0; iteration < 384; iteration++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const name = iteration % 2 ? "directory" : "file";
  transitions.push({ iteration, initial: (seed & 0o777).toString(8), name,
    argv: ["--", modes[iteration % modes.length], name], umask: masks[Math.floor(iteration / modes.length) % masks.length].toString(8) });
}
const controlsSource = originals[ownedTests[0]];
const controlMatch = /for \(const initial of \[([^\]]+)\]\) for \(const mode of (\[[^\n]+\])\)/u.exec(controlsSource);
const controlModes = JSON.parse(controlMatch[2]);
const controls = controlMatch[1].split(",").map(value => Number(value.trim())).flatMap(initial =>
  controlModes.map(mode => ({ initial: initial.toString(8), argv: ["--", mode, "directory"], umask: "22" })));
assert.equal(transitions.length, 384);
assert.equal(controls.length, 48);
const vectorProof = { exactOriginalSourceRestoredByReversingOnlyDeclaredPreconditionEdits: true,
  originalSourceHashes: Object.fromEntries(Object.entries(originals).map(([name, text]) => [name, hash(text)])),
  currentSourceHashes: Object.fromEntries(Object.entries(current).map(([name, text]) => [name, hash(text)])),
  modeVectors: modes, masks, transitionCount: transitions.length, controlCount: controls.length,
  transitionsSha256: hash(JSON.stringify(transitions)), controlsSha256: hash(JSON.stringify(controls)), transitions, controls,
  delta: "Native group is explicitly qualified to caller primary group before setid setup; requested initial modes verified exactly. Not unchanged-all-input proof." };
const before = inventory();
const nativeRoots = () => fs.readdirSync(path.join(root, "tests/commands/metadata-stress")).filter(name => name.startsWith(".native-")).sort();
const tmpRoots = () => fs.readdirSync("/tmp").filter(name => name.startsWith("virtual-bash-permission-profile-")).sort();
const nativeBefore = nativeRoots();
const tmpBefore = tmpRoots();
const executions = [];
function run(label, binary, args) {
  const started = new Date().toISOString();
  const result = spawnSync(binary, args, { cwd: root, env: { ...process.env, TSX_DISABLE_CACHE: "1" }, timeout: 120000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  executions.push({ label, binary, args, started, ended: new Date().toISOString(), status: result.status,
    signal: result.signal, error: result.error ? String(result.error) : null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
}
run("qualified-384", process.execPath, ["--import", "tsx", "--test", "--test-name-pattern", "^GNU chmod seeded symbolic/numeric differential: 384 mode transitions$", ownedTests[1]]);
run("chmod-controls-and-profile-regressions", process.execPath, ["--import", "tsx", "--test", ownedTests[0], ...ownedTests.slice(2, 5)]);
run("scoped-noemit-types", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...ownedTests]);
const oracle = path.join(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod");
const identity = { node: process.version, uv: process.versions.uv, platform: process.platform, arch: process.arch,
  uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(), egid: process.getegid(), groups: process.getgroups(),
  umask: process.umask().toString(8), uname: execFileSync("/usr/bin/uname", ["-a"], { encoding: "utf8" }),
  swVers: execFileSync("/usr/bin/sw_vers", [], { encoding: "utf8" }), oracle, oracleSha256: hash(fs.readFileSync(oracle)),
  oracleVersion: execFileSync(oracle, ["--version"], { encoding: "utf8" }),
  nodeExecutable: process.execPath, nodeSha256: hash(fs.readFileSync(process.execPath)) };
const after = inventory();
const changed = [...new Set([...Object.keys(before.records), ...Object.keys(after.records)])]
  .filter(name => before.records[name] !== after.records[name]);
const cleanup = { nativeBefore, nativeAfter: nativeRoots(), tmpBefore, tmpAfter: tmpRoots(), allChildExecutionsSettled: true,
  matchingExecutedProfileRoots: executions.flatMap(execution => [...execution.stdout.matchAll(/removed owned Darwin profile root (\S+)/gu)].map(match => ({ path: match[1], absent: !fs.existsSync(match[1]) }))) };
const additions = new Map();
const addJson = (name, value) => additions.set(name, JSON.stringify(value, null, 2) + "\n");
addJson("before.json.data", before);
addJson("after.json.data", after);
addJson("vectors.json.data", vectorProof);
addJson("identity.json.data", identity);
addJson("cleanup.json.data", cleanup);
addJson("execution.json.data", executions.map(({ stdout, stderr, ...execution }) => execution));
addJson("integrity.json.data", { beforeDigest: before.digest, afterDigest: after.digest, changed, files: Object.keys(after.records).length });
for (const execution of executions) {
  additions.set(`${execution.label}.stdout.log.data`, execution.stdout);
  additions.set(`${execution.label}.stderr.log.data`, execution.stderr);
}
const records = [...additions].map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text), sha256: hash(text) }));
addJson("MANIFEST.json", { recordedAt: new Date().toISOString(), classification: "author execution captures; data, not canonical source/tests", records });
let patch = "*** Begin Patch\n";
for (const [name, text] of additions) {
  assert.ok(text === "" || text.endsWith("\n"));
  patch += `*** Add File: ${output}/${name}\n`;
  if (text) patch += text.slice(0, -1).split("\n").map(line => `+${line}`).join("\n") + "\n";
}
patch += "*** End Patch\n";
execFileSync("apply_patch", [], { cwd: root, input: patch, maxBuffer: 2 * 1024 * 1024 });
for (const record of records) assert.equal(hash(fs.readFileSync(path.join(root, output, record.path))), record.sha256);
console.log(JSON.stringify({ output, executions: executions.map(({ label, status, signal, error }) => ({ label, status, signal, error })),
  changed, cleanup, transitionCount: transitions.length, controlCount: controls.length }, null, 2));
assert.deepEqual(changed, []);
assert.deepEqual(cleanup.nativeAfter, nativeBefore);
assert.deepEqual(cleanup.tmpAfter, tmpBefore);
assert.ok(cleanup.matchingExecutedProfileRoots.every(record => record.absent));
assert.ok(executions.every(execution => execution.status === 0 && execution.signal === null && execution.error === null));
