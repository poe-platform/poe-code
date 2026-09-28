import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { preProcessFile } from "typescript";
import { workspaceUnitSelections } from "./workspace-test-ownership.mjs";

export function checkCacheDirectory(environment = process.env) {
  return path.resolve(environment.POE_CHECK_CACHE_DIR ?? path.join(environment.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "poe-code", "checks-v1"));
}

function defaultCheckFiles(plan, environment, fileSystem, selected) {
  const cached = execFileSync("git", ["ls-files", "--cached", "-z", "--", ".", ":!packages/safe-bash/tests", ":!packages/safe-bash/benchmarks", ":!docs"], { cwd: plan.root, env: environment, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
  const byName = new Map(plan.workspaces.map(workspace => [workspace.name, workspace]));
  const edges = new Map(plan.workspaces.map(workspace => [workspace.name, []]));
  for (const edge of plan.edges) edges.get(edge.from)?.push(edge.to);
  const closure = new Set();
  const visit = name => {
    if (closure.has(name) || !byName.has(name)) return;
    closure.add(name);
    for (const dependency of edges.get(name) ?? []) visit(dependency);
  };
  for (const name of selected) visit(name);
  const otherPaths = [
    "src", "tests", "scripts",
    ...[...closure].map(name => {
      const workspace = byName.get(name);
      return workspace.path === "packages/safe-bash" ? "packages/safe-bash/src" : workspace.path;
    })
  ].filter(relative => {
    try { return fileSystem.existsSync(path.join(plan.root, relative)); } catch { return false; }
  });
  const others = otherPaths.length
    ? execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", ...otherPaths], { cwd: plan.root, env: environment, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean)
    : [];
  return [...cached, ...others];
}

export function createTaskFingerprints(plan, {
  fileSystem = fs,
  environment = process.env,
  selected = plan.workspaces.map(workspace => workspace.name),
  files = defaultCheckFiles(plan, environment, fileSystem, selected),
  runtime = { versions: process.versions, platform: process.platform, arch: process.arch },
  event = "test:unit"
} = {}) {
  const relevantNames = new Set(event === "build"
    ? ["NODE_ENV", "NODE_OPTIONS", "S3_HTTP_EXPORTS_REVISION", "FULL_GATE_ROOT"]
    : ["PATH", "TZ", "LANG", "LC_ALL", "LC_CTYPE", "NODE_ENV", "NODE_OPTIONS", "CI", "GITHUB_ACTIONS", "FORCE_COLOR", "NO_COLOR", "S3_HTTP_EXPORTS_REVISION", "FULL_GATE_ROOT"]);
  const relevantPrefixes = ["SAFE_BASH_", "SAFEJS_", "POE_CODE_"];
  const relevantEnvironment = Object.entries(environment).filter(([name, value]) => value !== undefined
    && (relevantNames.has(name) || relevantPrefixes.some(prefix => name.startsWith(prefix)))).map(([name, value]) => [name, name === "PATH" ? value.split(path.delimiter).filter(entry => !entry.includes("/.bun/bin")).map(entry => {
      const relative = path.relative(plan.root, entry);
      return !relative.startsWith("..") && !path.isAbsolute(relative) && entry.endsWith(path.join("node_modules", ".bin"))
        ? "$CHECKOUT/" + relative.split(path.sep).join("/") : entry;
    }).join(path.delimiter) : value]).sort(([a], [b]) => a.localeCompare(b));
  const common = createHash("sha256").update(JSON.stringify({ version: 1, runtime, environment: relevantEnvironment }));
  const owners = new Map(plan.workspaces.map(workspace => [workspace.path + "/", workspace.name]));
  const aliases = new Map(plan.workspaces.flatMap(workspace => [[workspace.name, workspace.name], ["@poe-code/" + path.basename(workspace.path), workspace.name]]));
  const dependencies = new Map(plan.workspaces.map(workspace => [workspace.name, new Set()]));
  for (const edge of plan.edges) dependencies.get(edge.from).add(edge.to);
  const grouped = new Map(plan.workspaces.map(workspace => [workspace.name, []]));
  const payloads = new Map(), modules = new Map();
  const uncacheable = new Set();
  const inputFiles = new Set();
  const ownerOf = file => owners.get(file.split("/").slice(0, 2).join("/") + "/");
  const read = file => {
    if (payloads.has(file)) return payloads.get(file);
    let bytes, identity;
    try {
      const stat = fileSystem.lstatSync(path.join(plan.root, file));
      if (stat.isSymbolicLink()) {
        identity = "link:" + fileSystem.readlinkSync(path.join(plan.root, file));
        if (fileSystem.statSync(path.join(plan.root, file)).isFile()) bytes = fileSystem.readFileSync(path.join(plan.root, file));
        else {
          uncacheable.add(ownerOf(file) ?? "*");
          bytes = Buffer.alloc(0);
        }
      }
      else if (stat.isFile()) { identity = String(stat.mode & 0o777); bytes = fileSystem.readFileSync(path.join(plan.root, file)); }
      else throw new Error("Check input is not a file: " + file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      identity ??= "deleted"; bytes = Buffer.alloc(0);
    }
    const digest = createHash("sha256").update(file + "\0" + identity + "\0").update(bytes).digest("hex");
    if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(path.extname(file))) {
      modules.set(file, preProcessFile(bytes.toString("utf8"), true, true).importedFiles.map(imported => imported.fileName));
    }
    payloads.set(file, digest);
    return digest;
  };
  for (const file of [...new Set(files)].sort()) {
    assert.ok(!path.isAbsolute(file) && !file.split("/").includes(".."), "Invalid check input path");
    if (file.split("/").some(segment => ["dist", "node_modules", ".turbo", "out", ".cache"].includes(segment)) || file.endsWith(".tsbuildinfo")) continue;
    inputFiles.add(file);
    const owner = ownerOf(file);
    if (owner) grouped.get(owner).push(file);
    else if (file === "package.json") {
      try {
        const parsed = JSON.parse(fileSystem.readFileSync(path.join(plan.root, file), "utf8"));
        common.update(createHash("sha256").update(JSON.stringify({
          type: parsed.type,
          workspaces: parsed.workspaces,
          dependencies: parsed.dependencies,
          devDependencies: parsed.devDependencies,
          optionalDependencies: parsed.optionalDependencies,
          peerDependencies: parsed.peerDependencies,
          overrides: parsed.overrides,
          engines: parsed.engines,
          packageManager: parsed.packageManager
        })).digest("hex"));
      } catch {
        common.update(read(file));
      }
    }
    else if ((event === "build"
      ? ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "turbo.json", "scripts/guard-package-dist.mjs", "scripts/build-workspaces.mjs", "scripts/bundle-safe-bash.mjs", "scripts/package-safe.mjs", "scripts/publish-bundle.mjs", "scripts/set-bin-executable.mjs"]
      : ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "turbo.json", "vitest.config.ts", "vitest.root.config.ts", "tests/setup.ts", "tests/test-env.ts", "scripts/guard-package-dist.mjs", "scripts/build-workspaces.mjs", "scripts/test-vitest-workspaces.mjs", "scripts/workspace-test-ownership.mjs", "scripts/run-vitest-batch.mjs", "scripts/vitest-batch-worker.mjs", "scripts/vitest-immediate-reporter.mjs", "packages/mcp-protocol-rust/scripts/cargo.mjs"]
    ).includes(file)) common.update(read(file));
  }
  const importedPackages = (file, visited = new Set(), rootInputs) => {
    if (visited.has(file)) return new Set();
    visited.add(file);
    read(file);
    if (rootInputs && !ownerOf(file)) rootInputs.update(read(file));
    const found = new Set();
    for (const specifier of modules.get(file) ?? []) {
      if (!specifier.startsWith(".")) {
        const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        if (aliases.has(name)) found.add(aliases.get(name));
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const extension = path.posix.extname(target);
      const stem = extension ? target.slice(0, -extension.length) : target;
      const resolved = [target, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].map(extension => stem + extension), target + "/index.ts"].find(candidate => inputFiles.has(candidate));
      if (!resolved) continue;
      const owner = ownerOf(resolved);
      if (owner && !ownerOf(file) && [".json", ".md", ".mustache", ".log"].includes(path.extname(resolved))) (rootInputs ?? common).update(read(resolved));
      else if (owner) found.add(owner);
      else for (const dependency of importedPackages(resolved, visited, rootInputs)) found.add(dependency);
    }
    return found;
  };
  const globalImports = new Set();
  for (const file of event === "build" ? [] : ["vitest.config.ts", "vitest.root.config.ts", "tests/setup.ts", "tests/test-env.ts"]) {
    if (inputFiles.has(file)) for (const name of importedPackages(file, new Set(), common)) globalImports.add(name);
  }
  const isWorkspaceTestFile = file => {
    const segments = file.split("/").slice(2);
    return segments[0] === "tests" || segments[0] === "test" || segments.includes("__tests__") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
  };
  const ownSource = new Map();
  const ownTests = new Map();
  const testDependencies = new Map(plan.workspaces.map(workspace => [workspace.name, new Set()]));
  const prepareSource = name => {
    assert.ok(grouped.has(name), "Unknown cache workspace: " + name);
    if (ownSource.has(name)) return;
    const hash = createHash("sha256");
    for (const file of grouped.get(name)) {
      if (isWorkspaceTestFile(file)) continue;
      hash.update(read(file));
      for (const dependency of importedPackages(file, new Set(), hash)) if (dependency !== name) dependencies.get(name).add(dependency);
    }
    ownSource.set(name, hash.digest("hex"));
    for (const dependency of dependencies.get(name)) prepareSource(dependency);
  };
  const prepareTests = name => {
    assert.ok(grouped.has(name), "Unknown cache workspace: " + name);
    if (ownTests.has(name)) return;
    prepareSource(name);
    const hash = createHash("sha256");
    for (const file of grouped.get(name)) {
      if (!isWorkspaceTestFile(file)) continue;
      hash.update(read(file));
      for (const dependency of importedPackages(file, new Set(), hash)) if (dependency !== name) testDependencies.get(name).add(dependency);
    }
    ownTests.set(name, hash.digest("hex"));
    for (const dependency of testDependencies.get(name)) prepareSource(dependency);
  };
  for (const name of selected) {
    if (event === "build") prepareSource(name);
    else prepareTests(name);
  }
  for (const name of globalImports) prepareSource(name);
  const shared = common.digest("hex");
  const fingerprints = new Map();
  for (const name of selected) {
    const closure = new Set();
    const visit = current => {
      if (closure.has(current)) return;
      closure.add(current);
      for (const dependency of dependencies.get(current)) visit(dependency);
      if (event !== "build" && current === name) {
        for (const dependency of testDependencies.get(current)) visit(dependency);
      }
    };
    visit(name);
    for (const globalName of globalImports) visit(globalName);
    if (uncacheable.has("*") || [...closure].some(current => uncacheable.has(current))) continue;
    const hash = createHash("sha256").update(shared).update("\0" + name + "\0");
    if (event !== "build") hash.update(ownTests.get(name));
    for (const current of [...closure].sort()) hash.update(current).update(ownSource.get(current));
    fingerprints.set(name, hash.digest("hex"));
  }
  return fingerprints;
}

export function taskCacheKey(fingerprint, event, args = []) {
  return createHash("sha256").update(JSON.stringify({ fingerprint, event, args })).digest("hex");
}

const knownPostbuildHooks = new Set([
  "node scripts/build-optional-cli.mjs",
  "node --test scripts/built-imports.test.mjs",
  "node scripts/smoke-built-exports.mjs"
]);

export function prepareBuildCache(plan, stages, { cacheStore, cacheFiles, environment, fileSystem = fs }) {
  const commands = new Set([
    "tsc",
    "tsc -p tsconfig.json",
    "rm -rf dist && tsc",
    "rm -rf dist && tsc && cp src/composition.json dist/composition.json",
    "tsc && node ./scripts/copy-corpus.mjs",
    "node ../../scripts/guard-package-dist.mjs && tsc",
    "node ../../scripts/guard-package-dist.mjs && tsc -p tsconfig.json",
    "node ../../scripts/guard-package-dist.mjs && tsc -p tsconfig.build.json",
    "node ../../scripts/guard-package-dist.mjs && rm -rf dist && tsc",
    "node ../../scripts/guard-package-dist.mjs && rm -rf dist && tsc -p tsconfig.json",
    "node ../../scripts/guard-package-dist.mjs && node --import tsx scripts/build-browser-run-code-guest.ts && tsc -p tsconfig.json",
    "node ../../scripts/guard-package-dist.mjs && rm -rf dist && tsc && esbuild src/index.ts --bundle --platform=browser --conditions=workerd --format=esm --target=es2022 --outfile=dist/index.js && esbuild src/portable.ts --bundle --platform=browser --format=esm --target=es2022 --outfile=dist/portable.js && esbuild src/index.ts --bundle --platform=browser --conditions=workerd --format=esm --target=es2022 --outfile=dist/index.browser.js && tsc -p tsconfig.browser.json",
    "node ../../scripts/guard-package-dist.mjs && tsc -p tsconfig.json && node scripts/native-assets.mjs",
    "node ../../scripts/guard-package-dist.mjs && tsc && node scripts/copy-templates.mjs",
    "node ../../scripts/guard-package-dist.mjs && tsc && node scripts/copy-assets.mjs",
    "node ../../scripts/guard-package-dist.mjs && tsc && cp LICENSE dist/",
    "node ../../scripts/guard-package-dist.mjs && tsc && cp LICENSE COPYING COPYING.LESSER dist/ && cp src/width-data.ts dist/width-data.ts",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=neutral --format=esm --target=es2022 --outfile=dist/index.js --metafile=dist/metafile.json",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/index.js",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/index.js && esbuild src/portable.ts --bundle --platform=browser --format=esm --target=es2022 --outfile=dist/portable.js",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=browser --format=esm --target=es2022 --external:safe-bash-contracts --external:safe-bash-contracts/* --outfile=dist/index.js",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --external:safe-bash-contracts --external:safe-bash-contracts/* --outfile=dist/index.js",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --external:safe-bash-contracts --external:safe-bash-contracts/* --external:@poe-code/safe-fs --external:@poe-code/safe-fs/* --outfile=dist/index.js",
    "node ../mcp-protocol-rust/scripts/cargo.mjs build",
    "node ../mcp-protocol-rust/scripts/cargo.mjs build && node -e \"fs.mkdirSync('dist', { recursive: true })\"",
    "node ../../scripts/guard-package-dist.mjs && mkdir -p dist && node scripts/build-wasm.mjs && tsc",
    "node ../../scripts/guard-package-dist.mjs && tsc && node scripts/bundle.mjs",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/index.js && esbuild src/portable.ts --bundle --platform=browser --format=esm --target=es2022 --outfile=dist/portable.js && esbuild src/index.ts --bundle --platform=browser --conditions=workerd --format=esm --target=es2022 --outfile=dist/index.browser.js && tsc -p tsconfig.browser.json",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --external:safe-bash-contracts --external:safe-bash-contracts/* --outfile=dist/index.js --external:@poe-code/image-ast",
    "node scripts/cargo.mjs build",
    "node scripts/prepare-host.mjs && node ../mcp-protocol-rust/scripts/cargo.mjs build",
    "node scripts/prepare-host.mjs && node ../mcp-protocol-rust/scripts/cargo.mjs build && tsc --project tsconfig.build.json",
    "node ../../scripts/guard-package-dist.mjs && node scripts/generate-provider-registry.mjs && tsc",
    "node scripts/generate-inventories.mjs && node ../../scripts/guard-package-dist.mjs && tsc",
    "node scripts/harfbuzz/verify.mjs && node scripts/generate-providers.mjs && node ../../scripts/guard-package-dist.mjs && tsc && node scripts/bundle.mjs",
    "node scripts/build.mjs",
    "tsc --noEmit && npm run build:site",
    "rm -rf dist && tsc --emitDeclarationOnly && node scripts/build.mjs",
    "node --import tsx scripts/generate-gh-workflows.ts && tsc && node --import tsx scripts/build-assets.ts",
    "node ../../scripts/guard-package-dist.mjs && rm -rf dist/opt-in && node scripts/integration-inputs.mjs && node scripts/build.mjs",
    "node ../../scripts/guard-package-dist.mjs && node scripts/numberformat-data.mjs && rm -rf dist && tsc && node scripts/numberformat-data.mjs --copy && node ../../scripts/set-bin-executable.mjs",
    "node ../../scripts/guard-package-dist.mjs && tsc && node -e \"require('node:fs').copyFileSync('src/SYSTEM_PROMPT.md', 'dist/SYSTEM_PROMPT.md')\"",
    "node ../../scripts/guard-package-dist.mjs && tsc && esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --external:@poe-platform/safe-bash --outfile=dist/index.js && rollup dist/index.d.ts --file dist/index.d.ts --format es --external @poe-platform/safe-bash/contracts --plugin dts={respectExternal:true}"
  ]);
  const outputs = new Map();
  const eligible = stages.filter(stage => {
    const event = stage.event ?? "build";
    const scripts = stage.manifest.scripts ?? {};
    const settings = { ...plan.configuration.tasks.build, ...plan.configuration.tasks[stage.name + "#build"] };
    const hasDistOutput = !scripts[event]?.includes("cargo.mjs build")
      || scripts[event].includes("prepare-host.mjs")
      || scripts[event].includes("fs.mkdirSync('dist'")
      || fileSystem.existsSync(path.join(plan.root, stage.path, "bindings/Cargo.toml"));
    const cacheable = settings.cache !== false && event === "build" && commands.has(scripts[event]) && hasDistOutput
      && !scripts["pre" + event] && (!scripts["post" + event] || knownPostbuildHooks.has(scripts["post" + event])) && settings.outputs?.length
      && settings.outputs.every(pattern => pattern === "dist/**" || pattern === "src/intl-data/dist/**");
    if (cacheable) outputs.set(stage.name, settings.outputs);
    return cacheable;
  });
  const started = performance.now();
  const fingerprints = eligible.length ? createTaskFingerprints(plan, { fileSystem, files: cacheFiles, environment, event: "build", selected: eligible.map(stage => stage.name) }) : new Map();
  const store = cacheStore ?? createCheckCache({ directory: checkCacheDirectory(environment), fileSystem });
  const stats = { cacheHits: 0, cacheMisses: 0, fingerprintMs: Math.round(performance.now() - started) };
  const pending = [];
  return {
    stats,
    restore(stage) {
      if (!fingerprints.has(stage.name)) return false;
      const record = store.read(taskCacheKey(fingerprints.get(stage.name), "build"));
      if (record?.success && Array.isArray(record.outputs)) {
        try {
          store.restore(path.join(plan.root, stage.path), outputs.get(stage.name), record.outputs);
          stats.cacheHits++;
          return true;
        } catch (error) {
          if (error.code === "EACCES" || error.code === "EPERM") throw error;
        }
      }
      stats.cacheMisses++;
      return false;
    },
    save(stage, durationMs) {
      if (!fingerprints.has(stage.name)) return;
      pending.push({ stage, value: {
        success: true, durationMs, outputs: store.capture(path.join(plan.root, stage.path), outputs.get(stage.name))
      } });
    },
    flush() {
      if (!pending.length) return;
      const started = performance.now();
      const current = createTaskFingerprints(plan, { fileSystem, files: cacheFiles, environment, event: "build", selected: pending.map(record => record.stage.name) });
      stats.fingerprintMs += Math.round(performance.now() - started);
      for (const { stage, value } of pending) {
        if (current.get(stage.name) === fingerprints.get(stage.name)) store.write(taskCacheKey(fingerprints.get(stage.name), "build"), value);
      }
      pending.length = 0;
    }
  };
}

const knownPretestHooks = new Set([
  "npm run typecheck:public",
  "node scripts/numberformat-data.mjs && npm run typecheck:fs",
  "node --import tsx scripts/build-browser-run-code-guest.ts",
  "npm run build"
]);

export function prepareNativeUnitCache(plan, stages, { cacheStore, cacheFiles, environment, fileSystem = fs }) {
  const manifests = new Map(plan.workspaces.map(workspace => [workspace.path, workspace.manifest]));
  const selections = new Map(workspaceUnitSelections(plan.root, fileSystem)
    .filter(selection => {
      const scripts = manifests.get(selection.path)?.scripts ?? {};
      return (selection.requiresNativePool && !selection.hasHooks)
        || (knownPretestHooks.has(scripts["pretest:unit"]) && scripts["posttest:unit"] === undefined);
    }).map(selection => [selection.path, selection]));
  const isRustUnitTask = stage => {
    if (!stage.path?.endsWith("-rust")) return false;
    const scripts = manifests.get(stage.path)?.scripts ?? {};
    return typeof scripts["test:unit"] === "string" && scripts["test:unit"].includes("cargo.mjs test")
      && scripts["pretest:unit"] === undefined && scripts["posttest:unit"] === undefined;
  };
  const eligible = stages.filter(stage => stage.path !== null && stage.event === "test:unit"
    && (selections.has(stage.path) || isRustUnitTask(stage))
    && ({ ...plan.configuration.tasks["test:unit"], ...plan.configuration.tasks[stage.name + "#test:unit"] }).cache !== false);
  if (!eligible.length) return undefined;
  const started = performance.now();
  const options = { fileSystem, files: cacheFiles, environment, selected: eligible.map(stage => stage.name) };
  const fingerprints = createTaskFingerprints(plan, options);
  const store = cacheStore ?? createCheckCache({ directory: checkCacheDirectory(environment), fileSystem });
  const stats = { unitCacheHits: 0, unitCacheMisses: 0, unitFingerprintMs: Math.round(performance.now() - started) };
  const pending = [];
  return {
    stats,
    restore(stage) {
      if (!fingerprints.has(stage.name)) return false;
      const record = store.read(taskCacheKey(fingerprints.get(stage.name), "test:unit:native", plan.testArguments));
      const hit = record?.success === true;
      stats[hit ? "unitCacheHits" : "unitCacheMisses"]++;
      if (hit) console.log(`Unit workspace ${stage.name}: cached native Vitest task`);
      return hit;
    },
    save(stage, durationMs) {
      if (fingerprints.has(stage.name)) pending.push({ stage, durationMs });
    },
    flush() {
      if (!pending.length) return;
      const started = performance.now();
      const current = createTaskFingerprints(plan, options);
      stats.unitFingerprintMs += Math.round(performance.now() - started);
      for (const { stage, durationMs } of pending) {
        if (current.get(stage.name) === fingerprints.get(stage.name)) store.write(taskCacheKey(fingerprints.get(stage.name), "test:unit:native", plan.testArguments), { success: true, durationMs });
      }
      pending.length = 0;
    }
  };
}

export function createCheckCache({
  directory = checkCacheDirectory(),
  fileSystem = fs,
  fallbackDirectory = fileSystem === fs ? path.resolve(os.tmpdir(), "poe-code", "checks-v1") : undefined,
  maxDirectoryBytes = 800 * 1024 * 1024,
  targetDirectoryBytes = 600 * 1024 * 1024
} = {}) {
  let writableDirectory = directory;
  const filename = (key, baseDirectory = directory) => {
    assert.ok(typeof key === "string" && key.length === 64 && [...key].every(character => "0123456789abcdef".includes(character)), "Invalid cache key");
    return path.join(baseDirectory, key + ".json.gz");
  };
  let accessCounter = 0;
  const touchFile = file => {
    try {
      const now = new Date(Date.now() + (++accessCounter));
      fileSystem.utimesSync?.(file, now, now);
    } catch (error) { void error; }
  };
  const readFrom = (key, baseDirectory) => {
    try {
      const file = filename(key, baseDirectory);
      const parsed = JSON.parse(gunzipSync(fileSystem.readFileSync(file), { maxOutputLength: 512 * 1024 * 1024 }).toString("utf8"));
      touchFile(file);
      return parsed;
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") throw error;
      return null;
    }
  };
  const pruneDirectory = (baseDirectory, preserveName) => {
    try {
      const entries = fileSystem.readdirSync(baseDirectory)
        .filter(name => name.endsWith(".json.gz"))
        .map((name, order) => {
          const full = path.join(baseDirectory, name);
          const stat = fileSystem.statSync(full);
          return { name, full, size: stat.size ?? 0, mtimeMs: stat.mtimeMs ?? 0, order };
        });
      const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
      if (totalBytes <= maxDirectoryBytes) return;
      entries.sort((a, b) => (a.name === preserveName ? -1 : b.name === preserveName ? 1 : b.mtimeMs - a.mtimeMs || b.order - a.order));
      let keptBytes = 0;
      for (const entry of entries) {
        if (entry.name === preserveName || keptBytes + entry.size <= targetDirectoryBytes) {
          keptBytes += entry.size;
        } else {
          try { fileSystem.rmSync(entry.full, { force: true }); } catch { /* Pruning is best effort; retain entries that cannot be removed. */ }
        }
      }
    } catch { /* Cache enumeration failures must not prevent writing a fresh entry. */ }
  };
  const writeTo = (key, value, baseDirectory) => {
    const destination = filename(key, baseDirectory);
    fileSystem.mkdirSync(baseDirectory, { recursive: true });
    const compressed = gzipSync(Buffer.from(JSON.stringify(value)));
    const temporary = destination + "." + randomUUID() + ".tmp";
    try {
      try {
        fileSystem.writeFileSync(temporary, compressed, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error?.code === "ENOSPC") {
          pruneDirectory(baseDirectory, path.basename(destination));
          fileSystem.writeFileSync(temporary, compressed, { flag: "wx", mode: 0o600 });
        } else {
          throw error;
        }
      }
      fileSystem.renameSync(temporary, destination);
      touchFile(destination);
      if (compressed.length > 1024 * 1024 || maxDirectoryBytes < 800 * 1024 * 1024) {
        pruneDirectory(baseDirectory, path.basename(destination));
      }
    } finally {
      try { fileSystem.rmSync(temporary, { force: true }); } catch {
        // Best-effort cleanup must not replace a write or rename failure.
      }
    }
  };
  const outputRoots = patterns => patterns.map(pattern => {
    assert.ok(pattern.endsWith("/**"), "Unsupported cached output pattern");
    const root = pattern.slice(0, -3);
    assert.ok(root && !path.isAbsolute(root) && root.split("/").every(segment => segment && segment !== "." && segment !== ".."), "Invalid output root");
    return root;
  });
  return {
    read(key) {
      if (fallbackDirectory && fallbackDirectory !== directory) {
        const hit = readFrom(key, fallbackDirectory);
        if (hit !== null) return hit;
      }
      return readFrom(key, directory);
    },
    write(key, value) {
      try {
        writeTo(key, value, writableDirectory);
      } catch (error) {
        if ((error.code === "EACCES" || error.code === "EPERM") && fallbackDirectory && fallbackDirectory !== writableDirectory) {
          writableDirectory = fallbackDirectory;
          writeTo(key, value, writableDirectory);
          return;
        }
        throw error;
      }
    },
    capture(root, patterns) {
      const records = [];
      const visit = relative => {
        const absolute = path.join(root, relative);
        const stat = fileSystem.lstatSync(absolute);
        assert.ok(!stat.isSymbolicLink(), "Cached outputs cannot contain symbolic links");
        if (stat.isDirectory()) for (const entry of fileSystem.readdirSync(absolute).sort()) visit(relative + "/" + entry);
        else {
          assert.ok(stat.isFile(), "Cached output must be a file");
          records.push({ path: relative, mode: stat.mode & 0o777, bytes: fileSystem.readFileSync(absolute).toString("base64") });
        }
      };
      for (const relative of outputRoots(patterns)) {
        if (fileSystem.existsSync(path.join(root, relative))) visit(relative);
      }
      return records;
    },
    restore(root, patterns, records) {
      const roots = outputRoots(patterns);
      assert.ok(Array.isArray(records), "Invalid cached outputs");
      const paths = new Set();
      for (const record of records) {
        assert.ok(typeof record.path === "string" && !path.isAbsolute(record.path) && record.path.split("/").every(segment => segment && segment !== "." && segment !== "..")
          && roots.some(relative => record.path.startsWith(relative + "/")) && !paths.has(record.path), "Invalid cached output path");
        assert.ok(typeof record.bytes === "string" && Number.isInteger(record.mode) && record.mode >= 0 && record.mode <= 0o777, "Invalid cached output record");
        paths.add(record.path);
      }
      assert.ok(fileSystem.realpathSync(root) === path.resolve(root), "Cached output root must be canonical");
      for (const relative of roots) {
        let ancestor = root;
        for (const segment of relative.split("/")) {
          ancestor = path.join(ancestor, segment);
          try { assert.ok(!fileSystem.lstatSync(ancestor).isSymbolicLink(), "Cached output ancestor cannot be a symbolic link"); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
      }
      const remaining = new Map(records.map(record => [record.path, record]));
      const directories = new Set(roots);
      for (const record of records) {
        let parent = path.posix.dirname(record.path);
        while (parent !== ".") { directories.add(parent); parent = path.posix.dirname(parent); }
      }
      const pending = [...roots];
      let unchanged = true;
      while (pending.length && unchanged) {
        const relative = pending.pop();
        const absolute = path.join(root, relative);
        let stat;
        try { stat = fileSystem.lstatSync(absolute); }
        catch (error) { if (error.code !== "ENOENT") throw error; unchanged = false; break; }
        if (stat.isSymbolicLink()) unchanged = false;
        else if (stat.isDirectory()) {
          if (!directories.has(relative)) unchanged = false;
          else for (const entry of fileSystem.readdirSync(absolute)) pending.push(relative + "/" + entry);
        } else {
          const record = remaining.get(relative);
          unchanged = stat.isFile() && stat.nlink === 1 && record !== undefined && (stat.mode & 0o777) === record.mode
            && fileSystem.readFileSync(absolute).equals(Buffer.from(record.bytes, "base64"));
          remaining.delete(relative);
        }
      }
      if (unchanged && remaining.size === 0) return;
      for (const relative of roots) fileSystem.rmSync(path.join(root, relative), { recursive: true, force: true });
      for (const record of records) {
        const absolute = path.join(root, record.path);
        fileSystem.mkdirSync(path.dirname(absolute), { recursive: true });
        fileSystem.writeFileSync(absolute, Buffer.from(record.bytes, "base64"), { mode: record.mode });
        fileSystem.chmodSync(absolute, record.mode);
      }
    }
  };
}
