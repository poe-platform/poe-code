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

export function createTaskFingerprints(plan, {
  fileSystem = fs,
  environment = process.env,
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: plan.root, env: environment, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean),
  runtime = { versions: process.versions, platform: process.platform, arch: process.arch },
  event = "test:unit",
  selected = plan.workspaces.map(workspace => workspace.name)
} = {}) {
  const volatile = new Set(["PWD", "OLDPWD", "INIT_CWD", "SHLVL", "_", "TMPDIR", "TEMP", "TMP", "TEST", "VITEST", "NODE_UNIQUE_ID", "VITEST_WORKER_ID", "VITEST_POOL_ID", "POE_CHECK_CACHE", "POE_CHECK_CACHE_DIR", "TURBO_FORCE"]);
  const relevantEnvironment = Object.entries(environment).filter(([name, value]) => value !== undefined
    && !volatile.has(name) && !name.startsWith("npm_") && !name.startsWith("CODEX_")
    && !name.startsWith("RUNNER_") && !name.startsWith("ACTIONS_")
    && (!name.startsWith("GITHUB_") || name === "GITHUB_ACTIONS")).map(([name, value]) => [name, name === "PATH" ? value.split(path.delimiter).map(entry => {
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
    else if (event === "build"
      ? ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "turbo.json", "scripts/guard-package-dist.mjs", "scripts/check-cache.mjs", "scripts/build-workspaces.mjs"].includes(file)
      : !file.includes("/") || ["src/", "tests/", "scripts/", ".github/"].some(prefix => file.startsWith(prefix))) common.update(read(file));
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
    if (inputFiles.has(file)) for (const name of importedPackages(file)) globalImports.add(name);
  }
  const own = new Map();
  const prepare = name => {
    assert.ok(grouped.has(name), "Unknown cache workspace: " + name);
    if (own.has(name)) return;
    const hash = createHash("sha256");
    for (const file of grouped.get(name)) {
      hash.update(read(file));
      for (const dependency of importedPackages(file, new Set(), hash)) if (dependency !== name) dependencies.get(name).add(dependency);
    }
    own.set(name, hash.digest("hex"));
    for (const dependency of dependencies.get(name)) prepare(dependency);
  };
  for (const name of [...selected, ...globalImports]) prepare(name);
  const shared = common.digest("hex");
  const fingerprints = new Map();
  for (const name of selected) {
    const closure = new Set();
    const visit = name => {
      if (closure.has(name)) return;
      closure.add(name);
      for (const dependency of dependencies.get(name)) visit(dependency);
    };
    visit(name);
    for (const name of globalImports) visit(name);
    if (uncacheable.has("*") || [...closure].some(name => uncacheable.has(name))) continue;
    const hash = createHash("sha256").update(shared).update("\0" + name + "\0");
    for (const name of [...closure].sort()) hash.update(name).update(own.get(name));
    fingerprints.set(name, hash.digest("hex"));
  }
  return fingerprints;
}

export function taskCacheKey(fingerprint, event, args = []) {
  return createHash("sha256").update(JSON.stringify({ fingerprint, event, args })).digest("hex");
}

export function prepareBuildCache(plan, stages, { cacheStore, cacheFiles, environment, fileSystem = fs }) {
  const commands = new Set(["tsc", "tsc -p tsconfig.json", "node ../../scripts/guard-package-dist.mjs && tsc", "node ../../scripts/guard-package-dist.mjs && tsc -p tsconfig.json", "node ../../scripts/guard-package-dist.mjs && tsc -p tsconfig.build.json"]);
  const eligible = stages.filter(stage => {
    const event = stage.event ?? "build";
    const scripts = stage.manifest.scripts ?? {};
    const settings = { ...plan.configuration.tasks.build, ...plan.configuration.tasks[stage.name + "#build"] };
    return settings.cache !== false && event === "build" && commands.has(scripts[event])
      && !scripts["pre" + event] && !scripts["post" + event] && settings.outputs?.length
      && settings.outputs.every(pattern => pattern === "dist/**");
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
          store.restore(path.join(plan.root, stage.path), ["dist/**"], record.outputs);
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
        success: true, durationMs, outputs: store.capture(path.join(plan.root, stage.path), ["dist/**"])
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

export function prepareNativeUnitCache(plan, stages, { cacheStore, cacheFiles, environment, fileSystem = fs }) {
  const selections = new Map(workspaceUnitSelections(plan.root, fileSystem)
    .filter(selection => selection.requiresNativePool && !selection.hasHooks).map(selection => [selection.path, selection]));
  const eligible = stages.filter(stage => stage.path !== null && stage.event === "test:unit" && selections.has(stage.path)
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

export function createCheckCache({ directory = checkCacheDirectory(), fileSystem = fs } = {}) {
  const filename = key => {
    assert.ok(typeof key === "string" && key.length === 64 && [...key].every(character => "0123456789abcdef".includes(character)), "Invalid cache key");
    return path.join(directory, key + ".json.gz");
  };
  const outputRoots = patterns => patterns.map(pattern => {
    assert.ok(pattern.endsWith("/**"), "Unsupported cached output pattern");
    const root = pattern.slice(0, -3);
    assert.ok(root && !path.isAbsolute(root) && root.split("/").every(segment => segment && segment !== "." && segment !== ".."), "Invalid output root");
    return root;
  });
  return {
    read(key) {
      try {
        return JSON.parse(gunzipSync(fileSystem.readFileSync(filename(key)), { maxOutputLength: 128 * 1024 * 1024 }).toString("utf8"));
      } catch (error) {
        if (error.code === "EACCES" || error.code === "EPERM") throw error;
        return null;
      }
    },
    write(key, value) {
      const destination = filename(key);
      fileSystem.mkdirSync(directory, { recursive: true });
      const temporary = destination + "." + randomUUID() + ".tmp";
      try {
        fileSystem.writeFileSync(temporary, gzipSync(Buffer.from(JSON.stringify(value))), { flag: "wx", mode: 0o600 });
        fileSystem.renameSync(temporary, destination);
      } finally {
        fileSystem.rmSync(temporary, { force: true });
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
      for (const relative of outputRoots(patterns)) visit(relative);
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
