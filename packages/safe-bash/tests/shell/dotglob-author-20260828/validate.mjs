import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const relativeOwn = path.relative(repository, own);
const candidateCommit = process.argv[2];
if (candidateCommit !== undefined) assert.match(candidateCommit, /^[a-f0-9]{40}$/);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const objectHash = (kind, bytes) => createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: repository, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const bindingPath = "tests/shell/directory-stack-independent-20260828/review-3e4cd743/BINDING-v1.json";
const bindingBytes = git("show", `0fe2274a:${bindingPath}`);
const binding = JSON.parse(bindingBytes);
const expectedTree = "099455f232870fa1ea59e1a0ae482e003fd170db";
const baseTree = git("rev-parse", `${binding.baseline}^{tree}`).toString().trim();
function composed(tree, prefix, overrides) {
  const raw = git("cat-file", "tree", tree);
  assert.equal(objectHash("tree", raw), tree);
  let offset = 0;
  const chunks = [];
  while (offset < raw.length) {
    const space = raw.indexOf(32, offset), nul = raw.indexOf(0, space);
    const mode = raw.subarray(offset, space).toString(), name = raw.subarray(space + 1, nul).toString();
    const original = raw.subarray(nul + 1, nul + 21).toString("hex"), key = prefix + name;
    const replacement = overrides.get(key) ?? (mode === "40000" && [...overrides.keys()].some(entry => entry.startsWith(key + "/")) ? composed(original, key + "/", overrides) : original);
    chunks.push(Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(replacement, "hex")]));
    offset = nul + 21;
  }
  return objectHash("tree", Buffer.concat(chunks));
}
const overrides = new Map(binding.source.filter(entry => entry.commit !== binding.baseline).map(entry => [entry.path, entry.blob]));
assert.equal(composed(baseTree, "", overrides), expectedTree);
const acceptedData = JSON.parse(gunzipSync(Buffer.from(git("show", "92b60355:tests/shell/directory-stack-design-20260828/runtime-v1/candidate-04.json.gz.base64").toString(), "base64")));
assert.equal(sha(Buffer.from(acceptedData.package.base64, "base64")), binding.expectedAuthorPackageSha256);
assert.equal(acceptedData.package.files, 846);
const capture = fs.mkdtempSync(path.join(own, "capture-"));
const work = path.join(capture, "work"), source = path.join(work, "source"), home = path.join(work, "home");
fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(home);
const driverBytes = fs.readFileSync(fileURLToPath(import.meta.url));
const report = { startedAt: new Date().toISOString(), role: "author-only selected composition", candidateCommit: candidateCommit ?? null, driver: { sha256: sha(driverBytes), base64: driverBytes.toString("base64") }, acceptedTree: expectedTree, bindingSha256: sha(bindingBytes), acceptedPackage: { sha256: acceptedData.package.sha256, files: acceptedData.package.files }, inputs: [], commands: [], layouts: {}, sourceBlobs: {}, node: { version: process.version, sha256: sha(fs.readFileSync(process.execPath)) }, nativeRuns: 0 };
const save = () => fs.writeFileSync(path.join(capture, "RESULTS.json"), JSON.stringify(report, null, 2) + "\n");
const put = (name, bytes) => { const target = path.join(source, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: "wx" }); };
const snapshot = root => {
  const entries = {};
  const visit = folder => {
    for (const name of fs.readdirSync(folder).sort()) {
      if (folder === root && name === "node_modules" && root === source) continue;
      const absolute = path.join(folder, name), stat = fs.lstatSync(absolute), key = path.relative(root, absolute);
      assert(!stat.isSymbolicLink(), `unexpected link ${key}`);
      if (stat.isDirectory()) { entries[key + "/"] = { mode: stat.mode & 0o777 }; visit(absolute); }
      else { assert(stat.isFile()); const bytes = fs.readFileSync(absolute); entries[key] = { mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha(bytes) }; }
    }
  };
  visit(root); return entries;
};
const npm = fs.realpathSync(path.join(path.dirname(process.execPath), "npm"));
const env = { PATH: path.dirname(process.execPath), HOME: home, TMPDIR: home, TSX_DISABLE_CACHE: "1", npm_config_cache: path.join(home, "cache"), npm_config_userconfig: path.join(home, "npmrc"), npm_config_globalconfig: path.join(home, "global-npmrc"), npm_config_ignore_scripts: "true", npm_config_offline: "true", npm_config_update_notifier: "false" };
fs.writeFileSync(env.npm_config_userconfig, ""); fs.writeFileSync(env.npm_config_globalconfig, "");
function command(label, args, cwd, expected = 0, timeout = 60000) {
  const result = spawnSync(process.execPath, args, { cwd, env, timeout, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
  const record = { label, args, cwd, timeout, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
  report.commands.push(record); save();
  assert.equal(record.signal, null, label); assert.equal(record.error, null, label);
  assert.equal(record.status, expected, `${label}: ${record.stdout}\n${record.stderr}`);
  return record;
}
try {
  for (const entry of binding.source) {
    assert(!entry.path.split("/").includes("AGENTS.md"));
    const original = git("show", `${entry.commit}:${entry.path}`);
    assert.equal(sha(original), entry.sha256, entry.path); assert.equal(objectHash("blob", original), entry.blob);
    assert.equal(original.length, entry.bytes);
    const mode = git("ls-tree", entry.commit, "--", entry.path).toString().split(" ")[0];
    assert.equal(mode, entry.mode);
    let selected = original;
    if (binding.overrides.includes(entry.path)) {
      if (candidateCommit === undefined) {
        assert.equal(git("diff", "--cached", "--", entry.path).length, 0, "foreign staged source");
        assert.equal(git("rev-parse", `HEAD:${entry.path}`).toString().trim(), entry.blob, "foreign committed source");
      }
      selected = candidateCommit === undefined ? fs.readFileSync(path.join(repository, entry.path)) : git("show", `${candidateCommit}:${entry.path}`);
      report.sourceBlobs[entry.path] = { base: entry.blob, blob: objectHash("blob", selected), sha256: sha(selected), base64: selected.toString("base64") };
      overrides.set(entry.path, objectHash("blob", selected));
    }
    put(entry.path, selected);
    report.inputs.push({ ...entry, selectedSha256: sha(selected), selectedBlob: objectHash("blob", selected) });
  }
  report.candidateComposedTree = composed(baseTree, "", overrides);
  const testPath = `${relativeOwn}/dotglob.test.ts`;
  const testBytes = candidateCommit === undefined ? fs.readFileSync(path.join(own, "dotglob.test.ts")) : git("show", `${candidateCommit}:${testPath}`);
  put(testPath, testBytes);
  report.authorTest = { path: testPath, sha256: sha(testBytes), base64: testBytes.toString("base64") };
  const regressionPaths = ["tests/shell/helpers.ts", "tests/shell/glob-budget.test.ts", "tests/shell/invoke.test.ts"];
  const existing = new Set(git("ls-tree", "-r", "--name-only", binding.baseline, "--", "tests/shell").toString().trim().split("\n"));
  report.regressionInputs = [];
  for (const name of regressionPaths) {
    assert(existing.has(name), `missing regression ${name}`);
    const bytes = git("show", `${binding.baseline}:${name}`);
    assert(!/child_process|bashResult/.test(bytes.toString()), "native oracle outside authorization");
    put(name, bytes);
    report.regressionInputs.push({ path: name, commit: binding.baseline, sha256: sha(bytes) });
  }
  const stackPath = "tests/shell/directory-stack-design-20260828/runtime-v1/stack.test.ts";
  const stackBytes = git("show", `${binding.candidate}:${stackPath}`);
  assert(!/child_process|bashResult/.test(stackBytes.toString()), "native oracle outside authorization");
  put(stackPath, stackBytes);
  report.regressionInputs.push({ path: stackPath, commit: binding.candidate, sha256: sha(stackBytes) });
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  const tsc = path.join(repository, "node_modules/typescript/bin/tsc");
  report.typescript = { version: JSON.parse(fs.readFileSync(path.join(repository, "node_modules/typescript/package.json"))).version, compilerSha256: sha(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))) };
  const before = snapshot(source); report.projectionBefore = before; save();
  command("production-build", [tsc, "-p", "tsconfig.build.json"], source);
  const config = { extends: "./tsconfig.json", compilerOptions: { noEmit: true }, include: ["src/**/*.ts", testPath, ...report.regressionInputs.map(entry => entry.path)], exclude: ["dist", "node_modules"] };
  fs.writeFileSync(path.join(source, "tsconfig.author.json"), JSON.stringify(config));
  command("strict-source-author-regressions", [tsc, "-p", "tsconfig.author.json"], source);
  const tsx = path.join(repository, "node_modules/tsx/dist/loader.mjs");
  command("source-dotglob", ["--import", tsx, "--test", "--test-timeout=20000", testPath], source);
  command("source-glob-invoke-regressions", ["--import", tsx, "--test", "--test-timeout=20000", ...regressionPaths.filter(name => name.endsWith(".test.ts"))], source);
  command("source-stack-regressions", ["--import", tsx, "--test", "--test-timeout=90000", stackPath], source, 0, 95000);
  const built = snapshot(source); report.projectionBuilt = built;
  const metadata = JSON.parse(command("pack", [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", work], source).stdout)[0];
  const packagePath = path.join(work, metadata.filename), packageBytes = fs.readFileSync(packagePath);
  assert.equal(metadata.files.length, 846);
  assert(metadata.files.some(entry => entry.path === "README.md"));
  report.package = { sha256: sha(packageBytes), bytes: packageBytes.length, metadata, base64: packageBytes.toString("base64") };
  const consumer = path.join(work, "installed"); fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ type: "module", private: true }));
  command("offline-install", [npm, "install", "--offline", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund", packagePath], consumer);
  const packageRoot = path.join(consumer, "node_modules/virtual-bash");
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json")));
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  assert.deepEqual(snapshot(path.join(packageRoot, "dist")), snapshot(path.join(source, "dist")));
  const packageSnapshot = snapshot(packageRoot); report.packageInventory = packageSnapshot;
  assert.deepEqual(Object.keys(packageSnapshot).filter(name => !name.endsWith("/")).sort(), metadata.files.map(entry => entry.path).sort());
  for (const entry of metadata.files) assert.equal(packageSnapshot[entry.path].bytes, entry.size);
  const ts = (await import(path.join(repository, "node_modules/typescript/lib/typescript.js"))).default;
  const emitted = ts.transpileModule(testBytes.toString(), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  assert.equal(emitted.split('"../../../src/index.js"').length, 2);
  fs.writeFileSync(path.join(consumer, "dotglob.test.mjs"), emitted.replace('"../../../src/index.js"', '"virtual-bash"'));
  const consumerCode = 'import { Shell, MemoryFileSystem } from "virtual-bash";\nimport { writeText } from "virtual-bash/contracts";\nconst shell = new Shell({ fs: new MemoryFileSystem() });\nawait shell.exec("shopt -s dotglob; shopt -q dotglob");\nawait shell.dispose();\nvoid writeText;\n';
  fs.writeFileSync(path.join(consumer, "consumer.mts"), consumerCode);
  const packageFiles = Object.fromEntries(Object.entries(packageSnapshot).filter(([name]) => !name.endsWith("/")));
  fs.writeFileSync(path.join(consumer, "admission.json"), JSON.stringify(packageFiles));
  const hook = 'import { registerHooks } from "node:module";\nimport { readFileSync, appendFileSync } from "node:fs";\nimport { createHash } from "node:crypto";\nimport { fileURLToPath } from "node:url";\nimport assert from "node:assert/strict";\nconst root = new URL("./", import.meta.url);\nconst product = new URL("node_modules/virtual-bash/", root);\nconst admission = JSON.parse(readFileSync(new URL("admission.json", root)));\nregisterHooks({ load(url, context, next) { if (url.startsWith("node:")) return next(url, context); assert(url.startsWith(root.href), "outside consumer load: " + url); if(url.startsWith(product.href)){ const key = decodeURIComponent(url.slice(product.href.length)); const bytes=readFileSync(fileURLToPath(url)); const digest=createHash("sha256").update(bytes).digest("hex"); assert.equal(digest, admission[key]?.sha256); appendFileSync(new URL("loads.jsonl",root),JSON.stringify({key,sha256:digest})+"\\n"); } return next(url,context); }});\n';
  fs.writeFileSync(path.join(consumer, "hook.mjs"), hook);
  const typeArgs = [tsc, "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--skipLibCheck", "--typeRoots", path.join(repository, "node_modules/@types"), "consumer.mts"];
  for (const layout of ["installed", "moved"]) {
    const current = path.join(work, layout);
    if (layout === "moved") { fs.renameSync(consumer, current); assert(!fs.existsSync(consumer)); }
    command(`${layout}-strict-consumer`, typeArgs, current);
    for (const [key, expression] of [["option", "new Shell({ fs: new MemoryFileSystem(), dotglob: true });"], ["limit", "new Shell({ fs: new MemoryFileSystem(), limits: { dotglob: true } });"]]) {
      fs.writeFileSync(path.join(current, "negative.mts"), 'import { Shell, MemoryFileSystem } from "virtual-bash";\n' + expression + "\n");
      const result = command(`${layout}-private-${key}`, [...typeArgs.slice(0, -1), "negative.mts"], current, 2);
      assert.equal((result.stdout.match(/error TS2353:/g) ?? []).length, 1);
      assert.equal((result.stdout.match(/error TS\d+:/g) ?? []).length, 1);
      assert(result.stdout.includes("'dotglob' does not exist in type 'Shell"));
      fs.writeFileSync(path.join(current, "negative.mts"), 'import { Shell, MemoryFileSystem } from "virtual-bash";\nnew Shell({ fs: new MemoryFileSystem() });\n');
      command(`${layout}-private-${key}-positive-inversion`, [...typeArgs.slice(0, -1), "negative.mts"], current);
    }
    command(`${layout}-public-subpath`, ["--import", "./hook.mjs", "--experimental-strip-types", "consumer.mts"], current);
    command(`${layout}-dotglob`, ["--import", "./hook.mjs", "--test", "--test-timeout=20000", "dotglob.test.mjs"], current);
    const trace = fs.readFileSync(path.join(current, "loads.jsonl"), "utf8");
    const loads = trace.trim().split("\n").map(row => JSON.parse(row));
    assert(loads.some(entry => entry.key === "dist/shell/runtime.js"));
    assert(loads.some(entry => entry.key === "dist/contracts/index.js"));
    report.layouts[layout] = { packageStable: true, loadedModules: [...new Set(loads.map(entry => entry.key))].sort(), traceSha256: sha(trace), oldPathAbsent: layout === "moved" ? !fs.existsSync(consumer) : null };
    assert.deepEqual(snapshot(path.join(current, "node_modules/virtual-bash")), packageSnapshot);
    fs.writeFileSync(path.join(capture, `${layout}-loads.jsonl`), trace, { flag: "wx" });
    fs.unlinkSync(path.join(current, "loads.jsonl"));
  }
  assert.deepEqual(snapshot(source), built);
  report.sourceStableIncludingNewEntries = true;
  report.finishedAt = new Date().toISOString(); report.success = true;
} catch (error) { report.success = false; report.failure = error.stack; throw error; }
finally { save(); process.stdout.write(`CAPTURE=${capture}\n`); }
