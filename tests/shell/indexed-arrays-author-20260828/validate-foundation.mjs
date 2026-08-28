import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const relativeOwn = path.relative(repository, own);
const revision = process.argv[2];
assert.match(revision ?? "", /^[a-f0-9]{40}$/u);
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
const attempt = fs.mkdtempSync(path.join(own, "foundation-attempt-"));
const source = path.join(attempt, "source");
fs.mkdirSync(source);
const report = { profile: "continuation author foundation development; not independent acceptance", revision, startedAt: new Date().toISOString(), baseTree: base.candidateComposedTree, baseInputs: base.inputs, overlays: {}, commands: [], success: false, nativeExecutions: 0 };
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
    timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024,
  });
  Object.assign(launch, { settledAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" }); save();
  assert.equal(result.signal, null, label);
  assert.equal(result.error, undefined, label);
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
  const modules = git("ls-tree", "-r", "--name-only", revision, "src/shell/arrays").toString().trim().split("\n");
  for (const name of ["src/shell/runtime.ts", "src/shell/parser.ts", "src/shell/shell.ts", ...modules, `${relativeOwn}/foundation.test.ts`, `${relativeOwn}/syntax.test.ts`, `${relativeOwn}/public-consumer.ts`]) {
    const bytes = git("show", `${revision}:${name}`);
    report.overlays[name] = { sha256: sha(bytes), blob: blob(bytes), base64: bytes.toString("base64") };
    put(name, bytes);
  }
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  const compiler = path.join(repository, "node_modules/typescript/bin/tsc");
  const loader = path.join(repository, "node_modules/tsx/dist/loader.mjs");
  report.toolchain = { node: process.version, nodeSha256: sha(fs.readFileSync(process.execPath)), compilerSha256: sha(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))), loaderSha256: sha(fs.readFileSync(loader)) };
  put("tsconfig.array-foundation.json", JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/**/*.ts", `${relativeOwn}/foundation.test.ts`, `${relativeOwn}/syntax.test.ts`], exclude: ["dist", "node_modules"] }));
  report.beforeBuild = snapshot(); save();
  run("selected-production-build", [compiler, "-p", "tsconfig.build.json"], 120000);
  run("strict-owned-consumers", [compiler, "-p", "tsconfig.array-foundation.json"], 120000);
  const before = snapshot();
  run("source-foundation-and-syntax", ["--import", loader, "--test", "--test-timeout=5000", `${relativeOwn}/foundation.test.ts`, `${relativeOwn}/syntax.test.ts`], 60000);
  assert.deepEqual(snapshot(), before);
  report.runtimeStableIncludingNewEntries = true;
  report.buildInventory = before;
  const npm = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  assert(fs.existsSync(npm));
  const packed = run("package-artifact", [npm, "pack", "--json", "--ignore-scripts", "--offline", "--pack-destination", attempt], 120000);
  const pack = JSON.parse(packed.stdout)[0];
  const artifact = fs.readFileSync(path.join(attempt, pack.filename));
  report.package = { sha256: sha(artifact), filename: pack.filename, files: pack.files, bytes: artifact.length, base64: artifact.toString("base64") };
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
  fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(installed, "consumer.ts"), fs.readFileSync(path.join(source, relativeOwn, "public-consumer.ts")));
  fs.writeFileSync(path.join(installed, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, outDir: "out", typeRoots: [path.join(repository, "node_modules/@types")] }, files: ["consumer.ts"] }));
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
  if (!(relative.startsWith("node_modules/virtual-bash/") || relative === "out/consumer.js")) throw new Error("Out-of-package runtime load: " + filename);
  const loaded = await nextLoad(url, context);
  fs.appendFileSync(path.join(root, "loads.jsonl"), JSON.stringify({ relative, sha256: createHash("sha256").update(fs.readFileSync(filename)).digest("hex") }) + "\\n");
  return loaded;
}
`);
  const publicLayout = label => {
    run(label + "-strict", [compiler, "-p", "tsconfig.json"], 120000, 0, installed);
    run(label + "-runtime", ["--import", "./load-hook.mjs", "out/consumer.js"], 60000, 0, installed);
    const loads = fs.readFileSync(path.join(installed, "loads.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert(loads.some(entry => entry.relative.endsWith("/dist/shell/arrays/bindings.js")));
    for (const entry of loads) if (entry.relative.startsWith("node_modules/virtual-bash/")) assert.equal(entry.sha256, packageInventory[entry.relative.slice("node_modules/virtual-bash/".length)], entry.relative);
    (report.layouts ??= []).push({ label, directory: installed, loads, publicFlows: 6 });
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
