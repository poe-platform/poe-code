import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const relativeRepair = path.relative(repository, own);
const relativeOwn = path.dirname(relativeRepair);
const revision = process.argv[2];
assert.match(revision ?? "", /^[a-f0-9]{40}$/u);
const productRevision = process.argv[3];
assert.match(productRevision ?? "", /^[a-f0-9]{40}$/u);
const mode = process.argv[4];
assert(["baseline", "successor"].includes(mode));
const c7 = "c7dae6e884d1a144266dfc1bb80785bf007a667f";
const originalRevision = "50117fc54fdfd650e8f57e84b82ba21297ab8a0f";
if (mode === "baseline") assert.equal(productRevision, c7);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const started = Date.now();
const git = (...args) => {
  assert(Date.now() - started < 60000, "authentication deadline");
  const result = spawnSync("git", args, { cwd: repository, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.equal(result.signal, null);
  return result.stdout;
};
const capsule = fs.readFileSync(path.join(repository, "tests/shell/dotglob-author-20260828/capture-07.json.gz.base64"));
assert.equal(sha(capsule), "0d10e6b256324146c2660f526767f9e6eb69e76b1abbda73348361ff3c74e88f");
const decoded = gunzipSync(Buffer.from(capsule.toString(), "base64"));
assert.equal(sha(decoded), "41fe4c9b59d249f9f8be3a196c9d48f5602d38587bb8d9a8fc6364062ff4b8de");
const base = JSON.parse(decoded).result;
assert.equal(base.inputs.length, 265);
assert.equal(base.candidateComposedTree, "37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e");
assert.equal(sha(Buffer.from(base.package.base64, "base64")), "b0544dcb3d0d9b22420932fc86e4d4693377fcc813fde6bde95c8625edc951aa");
const attempt = fs.mkdtempSync(path.join(own, mode + "-attempt-"));
const source = path.join(attempt, "source");
fs.mkdirSync(source);
const driverBytes = fs.readFileSync(fileURLToPath(import.meta.url));
assert.deepEqual(driverBytes, git("show", `${revision}:${relativeRepair}/validate-repair.mjs`), "committed validation driver");
const report = { profile: "S06 narrow author repair; not independent acceptance", revision, productRevision, mode, startedAt: new Date().toISOString(), driver: { sha256: sha(driverBytes), base64: driverBytes.toString("base64") }, baseTree: base.candidateComposedTree, baseInputs: base.inputs, overlays: {}, commands: [], success: false, nativeExecutions: 0 };
const save = () => fs.writeFileSync(path.join(attempt, "RESULTS.json"), JSON.stringify(report, null, 2) + "\n");
const put = (name, bytes) => {
  assert(!name.split("/").includes(".."));
  const target = path.join(source, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
};
const snapshot = () => {
  const entries = {};
  const visit = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (directory === source && name === "node_modules") continue;
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      assert(!stat.isSymbolicLink());
      if (stat.isDirectory()) visit(absolute);
      else entries[path.relative(source, absolute)] = sha(fs.readFileSync(absolute));
    }
  };
  visit(source);
  return entries;
};
const run = (label, args, timeout, expected = 0, cwd = source) => {
  const launch = { label, args, timeout, cwd, expected, launchedAt: new Date().toISOString() };
  report.commands.push(launch); save();
  const result = spawnSync(process.execPath, args, {
    cwd, env: { PATH: path.dirname(process.execPath), HOME: attempt, TMPDIR: attempt, LANG: "C", LC_ALL: "C", TSX_DISABLE_CACHE: "1", npm_config_cache: path.join(attempt, "npm-cache") },
    timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, detached: true,
  });
  Object.assign(launch, { settledAt: new Date().toISOString(), pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" }); save();
  assert.equal(result.signal, null, label);
  assert.equal(result.error, undefined, label);
  assert.throws(() => process.kill(-result.pid, 0), { code: "ESRCH" }, label + " process group absent");
  launch.processGroupAbsent = true;
  save();
  assert.equal(result.status, expected, `${label}: ${launch.stdout}\n${launch.stderr}`);
  return launch;
};
try {
  for (const input of base.inputs) {
    const original = git("show", `${input.commit}:${input.path}`);
    assert.equal(sha(original), input.sha256, input.path);
    assert.equal(blob(original), input.blob, input.path);
    const selected = base.sourceBlobs[input.path] ? Buffer.from(base.sourceBlobs[input.path].base64, "base64") : original;
    assert.equal(sha(selected), input.selectedSha256, input.path);
    assert.equal(blob(selected), input.selectedBlob, input.path);
    put(input.path, selected);
  }
  const sealBytes = git("show", `${revision}:${relativeRepair}/MANIFEST.json`);
  const seal = JSON.parse(sealBytes);
  report.preseal = { sha256: sha(sealBytes), ...seal };
  for (const entry of seal.files) {
    const bytes = git("show", `${entry.revision ?? revision}:${entry.path}`);
    assert.equal(sha(bytes), entry.sha256, entry.path);
  }
  const modules = ["bindings", "ledger", "state", "syntax"].map(name => "src/shell/arrays/" + name + ".ts");
  assert.deepEqual(git("ls-tree", "-r", "--name-only", c7, "src/shell/arrays").toString().trim().split("\n"), modules);
  const originalTests = ["foundation.test.ts", "syntax.test.ts", "public-consumer.ts"].map(name => relativeOwn + "/" + name);
  const repairTests = ["cases.ts", "regression.test.ts", "public-s06.ts"].map(name => relativeRepair + "/" + name);
  for (const name of ["src/shell/runtime.ts", "src/shell/parser.ts", "src/shell/shell.ts", ...modules, ...originalTests, ...repairTests]) {
    const selectedRevision = ["src/shell/runtime.ts", "src/shell/parser.ts", "src/shell/arrays/syntax.ts"].includes(name) ? productRevision : name.startsWith("src/") ? c7 : originalTests.includes(name) ? originalRevision : revision;
    const bytes = git("show", `${selectedRevision}:${name}`);
    report.overlays[name] = { sha256: sha(bytes), blob: blob(bytes), base64: bytes.toString("base64") };
    put(name, bytes);
  }
  const bindingBytes = git("show", "0fe2274a:tests/shell/directory-stack-independent-20260828/review-3e4cd743/BINDING-v1.json");
  assert.equal(sha(bindingBytes), base.bindingSha256);
  const binding = JSON.parse(bindingBytes);
  const baselineTree = git("rev-parse", `${binding.baseline}^{tree}`).toString().trim();
  const objectHash = (kind, bytes) => createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
  const compose = (tree, prefix, overrides) => {
    const raw = tree ? git("cat-file", "tree", tree) : Buffer.alloc(0);
    if (tree) assert.equal(objectHash("tree", raw), tree);
    const entries = new Map();
    for (let offset = 0; offset < raw.length;) {
      const space = raw.indexOf(32, offset);
      const nul = raw.indexOf(0, space);
      entries.set(raw.subarray(space + 1, nul).toString(), { mode: raw.subarray(offset, space).toString(), hash: raw.subarray(nul + 1, nul + 21).toString("hex") });
      offset = nul + 21;
    }
    for (const key of overrides.keys()) if (key.startsWith(prefix)) {
      const remaining = key.slice(prefix.length);
      const name = remaining.split("/")[0];
      if (!entries.has(name)) entries.set(name, { mode: remaining.includes("/") ? "40000" : "100644", hash: undefined });
    }
    const chunks = [];
    for (const [name, entry] of [...entries].sort(([leftName, left], [rightName, right]) => Buffer.compare(Buffer.from(leftName + (left.mode === "40000" ? "/" : "")), Buffer.from(rightName + (right.mode === "40000" ? "/" : ""))))) {
      const key = prefix + name;
      const descendants = [...overrides.keys()].some(pathname => pathname.startsWith(key + "/"));
      const hash = overrides.get(key) ?? (entry.mode === "40000" && descendants ? compose(entry.hash, key + "/", overrides) : entry.hash);
      assert(hash, key);
      chunks.push(Buffer.concat([Buffer.from(`${entry.mode} ${name}\0`), Buffer.from(hash, "hex")]));
    }
    return objectHash("tree", Buffer.concat(chunks));
  };
  const selections = new Map(base.inputs.map(input => [input.path, input.selectedBlob]));
  assert.equal(compose(baselineTree, "", selections), base.candidateComposedTree);
  for (const [name, entry] of Object.entries(report.overlays)) if (name.startsWith("src/")) selections.set(name, entry.blob);
  report.candidateSourceTree = compose(baselineTree, "", selections);
  report.selectedBuildInputCount = selections.size;
  assert.equal(selections.size, 269);
  if (mode === "baseline") assert.equal(report.candidateSourceTree, "d6c17f62d2d3062b5ab074044a86b8a455820373");
  report.selectedSourcePolicy = "accepted whole-tree identity plus owned source overrides; compact execution uses selected inputs only, not the full tree";
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  const compiler = path.join(repository, "node_modules/typescript/bin/tsc");
  const loader = path.join(repository, "node_modules/tsx/dist/loader.mjs");
  report.toolchain = { node: process.version, nodeSha256: sha(fs.readFileSync(process.execPath)), compilerSha256: sha(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))), loaderSha256: sha(fs.readFileSync(loader)) };
  report.toolchain.versions = Object.fromEntries(["typescript", "tsx", "@types/node"].map(name => [name, JSON.parse(fs.readFileSync(path.join(repository, "node_modules", name, "package.json"))).version]));
  put("tsconfig.array-foundation.json", JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/**/*.ts", `${relativeOwn}/foundation.test.ts`, `${relativeOwn}/syntax.test.ts`, `${relativeRepair}/regression.test.ts`, `${relativeRepair}/cases.ts`], exclude: ["dist", "node_modules"] }));
  put("source-load-hook.mjs", 'import { register } from "node:module"; register("./source-load-guard.mjs", import.meta.url);\n');
  put("source-load-guard.mjs", `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.dirname(fileURLToPath(import.meta.url));
const tools = ${JSON.stringify(path.join(repository, "node_modules"))};
export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  if (filename.startsWith(tools + path.sep)) return nextLoad(url, context);
  const relative = path.relative(root, filename);
  if (!(relative.startsWith("src/") || relative === ${JSON.stringify(`${relativeOwn}/foundation.test.ts`)} || relative === ${JSON.stringify(`${relativeOwn}/syntax.test.ts`)} || relative === ${JSON.stringify(`${relativeRepair}/regression.test.ts`)} || relative === ${JSON.stringify(`${relativeRepair}/cases.ts`)})) throw new Error("Out-of-profile source load: " + filename);
  if (/^src\\/commands\\/(?!basic\\.ts$|internal\\.ts$|execution\\.ts$|env-split\\.ts$)/u.test(relative)) throw new Error("Held command module load: " + relative);
  const expected = JSON.parse(fs.readFileSync(path.join(root, "source-expected.json")));
  const actual = createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
  if (expected[relative] !== actual) throw new Error("Source binding mismatch: " + relative);
  const loaded = await nextLoad(url, context);
  fs.appendFileSync(${JSON.stringify(path.join(attempt, "source-loads.jsonl"))}, JSON.stringify({ relative, sha256: createHash("sha256").update(fs.readFileSync(filename)).digest("hex"), loadedSha256: loaded.source === null || loaded.source === undefined ? null : createHash("sha256").update(loaded.source).digest("hex") }) + "\\n");
  return loaded;
}
`);
  put("source-expected.json", JSON.stringify(snapshot()));
  report.beforeBuild = snapshot(); save();
  run("selected-production-build", [compiler, "-p", "tsconfig.build.json"], 120000);
  run("strict-owned-consumers", [compiler, "-p", "tsconfig.array-foundation.json"], 120000);
  const before = snapshot();
  const testArgs = ["--import", "./source-load-hook.mjs", "--import", loader, "--test", "--test-timeout=5000", `${relativeOwn}/foundation.test.ts`, `${relativeOwn}/syntax.test.ts`];
  run("source-foundation-and-syntax", testArgs, 60000);
  const readLoads = expected => {
    const entries = fs.readFileSync(path.join(attempt, "source-loads.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    for (const entry of entries) assert.equal(entry.sha256, expected[entry.relative], entry.relative);
    fs.unlinkSync(path.join(attempt, "source-loads.jsonl"));
    return entries;
  };
  report.sourceLoads = readLoads(before);
  const targeted = run("source-S06-controls", ["--import", "./source-load-hook.mjs", "--import", loader, "--test", "--test-timeout=5000", relativeRepair + "/regression.test.ts"], 60000, mode === "baseline" ? 1 : 0);
  report.targetedLoads = readLoads(before);
  report.targetedFailures = [...targeted.stdout.matchAll(/^not ok \d+ - S06 control: (.+)$/gmu)].map(match => match[1]);
  const caseBytes = fs.readFileSync(path.join(source, relativeRepair, "cases.ts"), "utf8");
  const baselineFailures = [...caseBytes.matchAll(/id: "([^"]+)"[^\n]+baselineFailure: true/gmu)].map(match => match[1]);
  assert.deepEqual(report.targetedFailures, mode === "baseline" ? baselineFailures : []);
  assert.match(targeted.stdout, /# tests 51\b/u);
  assert.match(report.commands.find(command => command.label === "source-foundation-and-syntax").stdout, /# tests 32\b/u);
  assert.match(report.commands.find(command => command.label === "source-foundation-and-syntax").stdout, /AUTHOR_FLOW_COUNTS \{"publicExecs":69\}/u);
  assert.deepEqual(snapshot(), before);
  report.runtimeStableIncludingNewEntries = true;
  report.buildInventory = before;
  const mutations = [
    { name: "copied-slot-ownership", file: "src/shell/arrays/bindings.ts", from: "if (copy.values.get(index) === cloned) copy.values.delete(index);", to: "copy.values.delete(index);", assertion: "foundation: sparse assignment" },
    { name: "static-overflow-planning", file: "src/shell/runtime.ts", from: "if (demanded && planned !== null && planned > 2147483647)", to: "if (false && demanded && planned !== null && planned > 2147483647)", assertion: "foundation: static overflow" },
    { name: "zero-view", file: "src/shell/runtime.ts", from: "return binding ? binding.get(0) : state.variables[name];", to: "return state.variables[name];", assertion: "foundation: supported lazy bare" },
    { name: "final-stage-stale-guard", file: "src/shell/runtime.ts", from: 'if (!watch.valid()) throw new ArrayFailure("stale binding");\n      if (!(assignment.kind', to: 'if (false) throw new ArrayFailure("stale binding");\n      if (!(assignment.kind', assertion: "foundation: staged RHS mutation" },
    { name: "snapshot-epoch", file: "src/shell/arrays/state.ts", from: "if (monitor.epoch !== epoch) throw new ArrayFailure(\"stale state snapshot\");", to: "if (false) throw new ArrayFailure(\"stale state snapshot\");", assertion: "private state: whole-state epoch" },
    { name: "atomic-ticket-cursor", file: "src/shell/arrays/ledger.ts", from: "for (let index = 0; index < requested.length; index++) {", to: "this.#lastIssued = cursor; for (let index = 0; index < requested.length; index++) {", assertion: "private ledger: seven formulas" },
    { name: "cumulative-nonrefund", file: "src/shell/arrays/ledger.ts", from: "this.#used[3] -= admission.metadata;", to: "this.#used[3] -= admission.metadata; this.#used[4] -= admission.metadata + admission.payload;", assertion: "private ledger: seven formulas" },
    { name: "observer-retirement", file: "src/shell/arrays/bindings.ts", from: "this.watches.delete(name);", to: "void name;", assertion: "private ledger: last observer retires" },
    { name: "root-work-drain", file: "src/shell/arrays/ledger.ts", from: "if (this.#holds) await this.#idle;", to: "if (false) await this.#idle;", assertion: "private ownership: root close drains" },
    { name: "repeated-aggregate-splice", file: "src/shell/runtime.ts", from: "if (position > 0) {\n            owner?.reserve", to: "if (true) {\n            owner?.reserve", assertion: "foundation: repeated aggregate splice" },
  ];
  report.mutations = [];
  report.sourceExpectedBase64 = fs.readFileSync(path.join(source, "source-expected.json")).toString("base64");
  for (const mutation of mode === "successor" ? mutations : []) {
    const filename = path.join(source, mutation.file);
    const original = fs.readFileSync(filename, "utf8");
    assert.equal(original.split(mutation.from).length, 2, mutation.name);
    const altered = original.replace(mutation.from, mutation.to);
    const entry = { ...mutation, originalSha256: sha(original), alteredSha256: sha(altered) };
    report.mutations.push(entry); save();
    try {
      fs.writeFileSync(filename, altered);
      put("source-expected.json", JSON.stringify({ ...JSON.parse(Buffer.from(report.sourceExpectedBase64, "base64").toString()), [mutation.file]: sha(altered) }));
      const result = run("loaded-mutant-" + mutation.name, testArgs, 60000, 1);
      assert(result.stdout.split("\n").some(line => line.startsWith("not ok ") && line.includes(mutation.assertion)), mutation.name);
      assert.doesNotMatch(result.stderr, /Out-of-profile|Held command module|Transform failed|ERR_MODULE_NOT_FOUND/u);
      entry.loads = readLoads({ ...before, [mutation.file]: sha(altered) });
      assert(entry.loads.some(load => load.relative === mutation.file && load.sha256 === sha(altered)));
      entry.executedAssertionRejected = true;
    } finally { fs.writeFileSync(filename, original); put("source-expected.json", Buffer.from(report.sourceExpectedBase64, "base64")); }
  }
  assert.deepEqual(snapshot(), before, "all loaded mutants restored including new-entry checks");
  const npm = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  assert(fs.existsSync(npm));
  const packed = run("package-artifact", [npm, "pack", "--json", "--ignore-scripts", "--offline", "--pack-destination", attempt], 120000);
  const pack = JSON.parse(packed.stdout)[0];
  const artifact = fs.readFileSync(path.join(attempt, pack.filename));
  report.package = { sha256: sha(artifact), filename: pack.filename, files: pack.files, bytes: artifact.length, base64: artifact.toString("base64") };
  assert.equal(pack.files.length, 862);
  if (mode === "baseline") assert.equal(report.package.sha256, "0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26");
  let installed = path.join(attempt, "installed");
  const packagePath = path.join(installed, "node_modules/virtual-bash");
  fs.mkdirSync(packagePath, { recursive: true });
  const tar = gunzipSync(artifact);
  const packageInventory = {};
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/su, "");
    const prefix = string(345, 155);
    const name = (prefix ? prefix + "/" : "") + string(0, 100);
    const size = Number.parseInt(string(124, 12).trim(), 8);
    assert(Number.isSafeInteger(size) && size >= 0);
    offset += 512;
    const content = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const kind = string(156, 1);
    if (kind === "x" || kind === "g" || kind === "5") continue;
    assert(kind === "0" || kind === "", `unsupported artifact entry ${name}: ${kind}`);
    assert(name.startsWith("package/") && !name.split("/").includes(".."));
    const relative = name.slice(8);
    const destination = path.join(packagePath, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, { flag: "wx" });
    packageInventory[relative] = sha(content);
  }
  assert.deepEqual(Object.keys(packageInventory).sort(), pack.files.map(file => file.path).sort());
  const manifest = JSON.parse(fs.readFileSync(path.join(packagePath, "package.json")));
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert(!fs.existsSync(path.join(packagePath, "src")));
  report.package.inventory = packageInventory;
  const verifyPackage = directory => {
    const actual = {};
    const visit = folder => {
      for (const name of fs.readdirSync(folder).sort()) {
        const absolute = path.join(folder, name);
        const stat = fs.lstatSync(absolute);
        assert(!stat.isSymbolicLink());
        if (stat.isDirectory()) visit(absolute);
        else actual[path.relative(directory, absolute)] = sha(fs.readFileSync(absolute));
      }
    };
    visit(directory);
    assert.deepEqual(actual, packageInventory, "package runtime stability including new entries");
  };
  fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(installed, "consumer.ts"), fs.readFileSync(path.join(source, relativeOwn, "public-consumer.ts")));
  for (const name of ["public-s06.ts", "cases.ts"]) fs.writeFileSync(path.join(installed, name), fs.readFileSync(path.join(source, relativeRepair, name)));
  fs.writeFileSync(path.join(installed, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, outDir: "out", typeRoots: [path.join(repository, "node_modules/@types")] }, files: ["consumer.ts", "public-s06.ts", "cases.ts"] }));
  fs.writeFileSync(path.join(installed, "load-hook.mjs"), 'import { register } from "node:module"; register("./load-guard.mjs", import.meta.url);\n');
  fs.writeFileSync(path.join(installed, "load-guard.mjs"), `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.dirname(fileURLToPath(import.meta.url));
export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const filename = fileURLToPath(url);
  const relative = path.relative(root, filename);
  if (!(relative.startsWith("node_modules/virtual-bash/") || relative === "out/consumer.js" || relative === "out/public-s06.js" || relative === "out/cases.js")) throw new Error("Out-of-package runtime load: " + filename);
  const loaded = await nextLoad(url, context);
  fs.appendFileSync(path.join(root, "loads.jsonl"), JSON.stringify({ relative, sha256: createHash("sha256").update(fs.readFileSync(filename)).digest("hex") }) + "\\n");
  return loaded;
}
`);
  const publicLayout = label => {
    run(label + "-strict", [compiler, "-p", "tsconfig.json"], 120000, 0, installed);
    run(label + "-runtime", ["--import", "./load-hook.mjs", "out/consumer.js"], 60000, 0, installed);
    if (mode === "successor") {
      const targeted = run(label + "-S06-runtime", ["--import", "./load-hook.mjs", "out/public-s06.js"], 60000, 0, installed);
      assert.equal([...targeted.stdout.matchAll(/^S06_PUBLIC_PASS /gmu)].length, 50);
    }
    const loads = fs.readFileSync(path.join(installed, "loads.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert(loads.some(entry => entry.relative.endsWith("/dist/shell/arrays/bindings.js")));
    for (const entry of loads) if (entry.relative.startsWith("node_modules/virtual-bash/")) assert.equal(entry.sha256, packageInventory[entry.relative.slice("node_modules/virtual-bash/".length)], entry.relative);
    (report.layouts ??= []).push({ label, directory: installed, loads, publicFlows: 6, s06PublicFlows: mode === "successor" ? 50 : 0 });
    verifyPackage(path.join(installed, "node_modules/virtual-bash"));
    fs.renameSync(path.join(installed, "loads.jsonl"), path.join(installed, `${label}-loads.jsonl`));
  };
  publicLayout("installed");
  const moved = path.join(attempt, "physically-moved");
  fs.renameSync(installed, moved);
  assert(!fs.existsSync(installed));
  installed = moved;
  publicLayout("moved");
  fs.writeFileSync(path.join(installed, "negative.ts"), 'import { Shell, MemoryFileSystem, ArrayLedger } from "virtual-bash"; new Shell({ fs: new MemoryFileSystem(), maxArrayBytes: 1 });\n');
  const negative = run("unchanged-public-api-negative-control", [compiler, "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--typeRoots", path.join(repository, "node_modules/@types"), "negative.ts"], 120000, 2, installed);
  assert.match(negative.stdout, /no exported member.*ArrayLedger/u);
  assert.match(negative.stdout, /maxArrayBytes.*does not exist/u);
  verifyPackage(path.join(installed, "node_modules/virtual-bash"));
  report.package.stableIncludingNewEntries = true;
  assert.deepEqual(snapshot(), before, "package phases must not alter selected source/build inventory");
  report.success = true;
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  report.ownedChildrenSettled = report.commands.every(command => command.settledAt !== undefined);
  save();
  fs.writeFileSync(path.join(attempt, "RESULTS.json.gz.base64"), gzipSync(Buffer.from(JSON.stringify(report))).toString("base64") + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ attempt: path.relative(repository, attempt), success: report.success, commands: report.commands.map(command => ({ label: command.label, status: command.status, signal: command.signal })), failure: report.failure }) + "\n");
}
