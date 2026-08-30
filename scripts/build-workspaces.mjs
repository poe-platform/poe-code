import assert from "node:assert/strict";
import { spawn as spawnChild } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies"];
const identityFields = ["dev", "ino", "mode", "size", "nlink", "mtimeMs", "ctimeMs"];
const compareNames = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function throwFailures(failures, message) {
  if (failures.length > 1) throw new AggregateError(failures, message);
  if (failures.length) throw failures[0];
}

function directory(directoryPath, fileSystem) {
  const metadata = fileSystem.lstatSync(directoryPath);
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), `Not a regular directory: ${directoryPath}`);
  assert.equal(fileSystem.realpathSync(directoryPath), directoryPath, `Noncanonical directory: ${directoryPath}`);
  const names = fileSystem.readdirSync(directoryPath);
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length, `Case aliases: ${directoryPath}`);
  return names;
}

export function readManifest(directoryPath, filename = "package.json", fileSystem = fs) {
  const names = directory(directoryPath, fileSystem);
  if (!names.includes(filename)) {
    assert.ok(!names.some(name => name.toLowerCase() === filename.toLowerCase()), `Manifest alias: ${filename}`);
    return undefined;
  }
  const filenamePath = path.join(directoryPath, filename);
  const before = fileSystem.lstatSync(filenamePath);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, `Nonregular manifest: ${filenamePath}`);
  assert.ok(before.size <= 1024 * 1024, `Manifest exceeds 1MiB: ${filenamePath}`);
  assert.equal(fileSystem.realpathSync(filenamePath), filenamePath);
  const descriptor = fileSystem.openSync(filenamePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const failures = [];
  let text;
  try {
    const opened = fileSystem.fstatSync(descriptor);
    for (const field of identityFields) assert.equal(opened[field], before[field], `Manifest identity: ${field}`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fileSystem.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0, "Short manifest read");
      offset += count;
    }
    const after = fileSystem.fstatSync(descriptor);
    for (const field of identityFields) assert.equal(after[field], before[field], `Manifest identity: ${field}`);
    text = bytes.toString("utf8");
  } catch (error) {
    failures.push(error);
  }
  try { fileSystem.closeSync(descriptor); } catch (error) { failures.push(error); }
  throwFailures(failures, "Manifest read and close failed");
  const manifest = JSON.parse(text);
  assert.ok(manifest && typeof manifest === "object" && !Array.isArray(manifest), `Invalid manifest: ${filenamePath}`);
  return manifest;
}

function stableVersion(value) {
  assert.equal(typeof value, "string", "A caret workspace dependency needs a version");
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, `Unsupported stable version: ${value}`);
  const parts = value.split(".").map(Number);
  assert.ok(parts.every(Number.isSafeInteger), "Version component exceeds safe integer");
  return parts;
}

export function matchesWorkspaceRange(specifier, version) {
  if (specifier === "*") return true;
  assert.equal(typeof specifier, "string");
  assert.ok(specifier.startsWith("^"), `Unsupported local dependency range: ${specifier}`);
  const lower = stableVersion(specifier.slice(1));
  const actual = stableVersion(version);
  const difference = actual.findIndex((part, index) => part !== lower[index]);
  if (difference >= 0 && actual[difference] < lower[difference]) return false;
  if (lower[0] > 0) return actual[0] === lower[0];
  if (lower[1] > 0) return actual[0] === 0 && actual[1] === lower[1];
  return actual.every((part, index) => part === lower[index]);
}

function validateBuildConfiguration(configuration, names) {
  assert.ok(configuration && typeof configuration === "object");
  assert.ok(Object.keys(configuration).every(key => ["$schema", "globalDependencies", "tasks"].includes(key)), "Unsupported global build configuration");
  if (configuration.globalDependencies !== undefined) assert.ok(Array.isArray(configuration.globalDependencies) && configuration.globalDependencies.every(value => typeof value === "string"));
  assert.ok(configuration.tasks && typeof configuration.tasks === "object" && !Array.isArray(configuration.tasks));
  assert.ok(Object.hasOwn(configuration.tasks, "build"), "Missing build task configuration");
  for (const [name, task] of Object.entries(configuration.tasks)) {
    if (name !== "build" && !name.endsWith("#build")) continue;
    if (name !== "build") assert.ok(names.has(name.slice(0, -6)), `Unknown build override: ${name}`);
    assert.ok(task && typeof task === "object" && !Array.isArray(task));
    assert.ok(Object.keys(task).every(key => ["dependsOn", "inputs", "outputs", "cache"].includes(key)), `Unsupported build task configuration: ${name}`);
    assert.deepEqual(task.dependsOn, ["^build"], `Unsupported build dependencies: ${name}`);
    for (const field of ["inputs", "outputs"]) {
      if (task[field] !== undefined) assert.ok(Array.isArray(task[field]) && task[field].every(value => typeof value === "string"));
    }
    if (task.cache !== undefined) assert.equal(typeof task.cache, "boolean");
  }
}

export function createWorkspaceBuildPlan(rootDirectory, fileSystem = fs) {
  const root = path.resolve(rootDirectory);
  const rootManifest = readManifest(root, "package.json", fileSystem);
  assert.ok(rootManifest, "Missing root package.json");
  assert.deepEqual(rootManifest.workspaces, ["packages/*"], "Unsupported workspace layout");
  const rootNames = directory(root, fileSystem);
  assert.ok(!rootNames.some(name => name.toLowerCase() === "turbo.jsonc"), "Unsupported turbo.jsonc");
  assert.ok(rootNames.includes("packages"), "Missing literal packages directory");
  const configuration = readManifest(root, "turbo.json", fileSystem);
  const packagesDirectory = path.join(root, "packages");
  const names = directory(packagesDirectory, fileSystem).sort(compareNames);
  const workspaces = [], manifestless = [];
  for (const name of names) {
    if (name.startsWith(".") || name === "node_modules") continue;
    assert.ok(!name.includes("\\"), `Unsupported workspace spelling: ${name}`);
    const workspaceDirectory = path.join(packagesDirectory, name);
    const metadata = fileSystem.lstatSync(workspaceDirectory);
    assert.ok(!metadata.isSymbolicLink(), `Workspace symlink: ${name}`);
    if (!metadata.isDirectory()) continue;
    const entries = directory(workspaceDirectory, fileSystem);
    assert.ok(!entries.some(entry => ["turbo.json", "turbo.jsonc"].includes(entry.toLowerCase())), `Unsupported local Turbo configuration: ${name}`);
    const manifest = readManifest(workspaceDirectory, "package.json", fileSystem);
    if (!manifest) { manifestless.push(`packages/${name}`); continue; }
    assert.equal(typeof manifest.name, "string", `Missing workspace name: ${name}`);
    assert.ok(manifest.name.length > 0);
    const scripts = manifest.scripts ?? {};
    assert.ok(scripts && typeof scripts === "object" && !Array.isArray(scripts));
    for (const event of ["prebuild", "build", "postbuild"]) {
      if (scripts[event] !== undefined) assert.ok(typeof scripts[event] === "string" && scripts[event].trim().length > 0, `Invalid ${event}: ${manifest.name}`);
    }
    workspaces.push({ name: manifest.name, path: `packages/${name}`, version: manifest.version, build: scripts.build ?? null, manifest });
  }
  const byName = new Map(workspaces.map(workspace => [workspace.name, workspace]));
  assert.equal(byName.size, workspaces.length, "Duplicate workspace names");
  validateBuildConfiguration(configuration, byName);
  const edges = [], dependencies = new Map(workspaces.map(workspace => [workspace.name, new Set()]));
  for (const workspace of workspaces) {
    const references = new Map();
    for (const field of dependencyFields) {
      const entries = workspace.manifest[field] ?? {};
      assert.ok(entries && typeof entries === "object" && !Array.isArray(entries));
      for (const [name, specifier] of Object.entries(entries)) {
        assert.equal(typeof specifier, "string", `Invalid dependency: ${workspace.name} -> ${name}`);
        if (!byName.has(name)) continue;
        if (references.has(name)) assert.equal(references.get(name), specifier, `Conflicting local dependency ranges: ${name}`);
        references.set(name, specifier);
        if (!matchesWorkspaceRange(specifier, byName.get(name).version)) continue;
        dependencies.get(workspace.name).add(name);
      }
    }
    const peers = workspace.manifest.peerDependencies ?? {};
    assert.ok(peers && typeof peers === "object" && !Array.isArray(peers));
    for (const name of Object.keys(peers)) assert.ok(!byName.has(name), `Unsupported internal peer dependency: ${name}`);
    for (const name of dependencies.get(workspace.name)) edges.push({ from: workspace.name, to: name });
  }
  const pending = new Map(dependencies), completed = new Set(), layers = [];
  while (pending.size) {
    const layer = [...pending.keys()].filter(name => [...pending.get(name)].every(dependency => completed.has(dependency))).sort(compareNames);
    assert.ok(layer.length, `Workspace dependency cycle: ${[...pending.keys()].sort(compareNames).join(", ")}`);
    for (const name of layer) { pending.delete(name); completed.add(name); }
    layers.push(layer);
  }
  const stages = layers.flat().map(name => {
    const workspace = byName.get(name);
    assert.ok(workspace);
    return workspace;
  }).filter(workspace => workspace.build !== null);
  return { root, workspaces, edges, layers, stages, manifestless, noBuild: workspaces.filter(workspace => workspace.build === null).map(workspace => ({ name: workspace.name, path: workspace.path, status: "NO_DECLARED_BUILD_NOT_A_PASS" })) };
}

function taskError(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

export async function buildWorkspaces(rootDirectory, { environment = process.env, spawn = spawnChild, host = process, fileSystem = fs } = {}) {
  assert.ok(environment.npm_execpath && path.isAbsolute(environment.npm_execpath), "Run this entrypoint through npm run build");
  for (const [name, value] of Object.entries(environment)) {
    if (["npm_config_ignore_scripts", "npm_config_if_present", "npm_config_include_workspace_root"].includes(name.toLowerCase())) {
      assert.ok(value === undefined || value === "false", `Unsupported lifecycle or workspace option: ${name}`);
    }
  }
  assert.equal(host.platform === "win32", false, "Workspace process-group cleanup currently supports POSIX hosts");
  const plan = createWorkspaceBuildPlan(rootDirectory, fileSystem);
  const failures = [], registered = [];
  let active, interrupted, forceTimer;
  const signal = (pid, value) => {
    try { host.kill(-pid, value); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  };
  const stop = value => {
    interrupted ??= value;
    if (active?.pid) {
      try { signal(active.pid, value); } catch (error) { failures.push(error); }
      forceTimer ??= setTimeout(() => { try { if (active?.pid) signal(active.pid, "SIGKILL"); } catch (error) { failures.push(error); } }, 2000);
    }
  };
  const handlers = new Map(["SIGINT", "SIGTERM"].map(value => [value, () => stop(value)]));
  let completed = 0;
  try {
    for (const [value, handler] of handlers) { registered.push(value); host.on(value, handler); }
    for (const workspace of plan.stages) {
      if (interrupted) throw taskError(`Build interrupted by ${interrupted}`);
      const args = [environment.npm_execpath, "--prefix", plan.root, "run", "build", `--workspace=${workspace.path}`, "--include-workspace-root=false", "--if-present=false"];
      const childFailures = [];
      let resolveClose;
      const closed = new Promise(resolve => { resolveClose = resolve; });
      active = spawn(host.execPath, args, { cwd: plan.root, env: { ...environment }, stdio: "inherit", detached: true });
      const started = active;
      const onError = error => childFailures.push(error);
      const onClose = (code, receivedSignal) => resolveClose({ code, signal: receivedSignal });
      const observers = [["close", onClose], ["error", onError]];
      try {
        for (const [event, observer] of observers) started.once(event, observer);
      } catch (error) {
        childFailures.push(error);
        for (const [event, observer] of observers) {
          EventEmitter.prototype.removeListener.call(started, event, observer);
          EventEmitter.prototype.on.call(started, event, observer);
        }
        if (started.pid) {
          try { signal(started.pid, "SIGTERM"); } catch (error) { childFailures.push(error); }
          forceTimer ??= setTimeout(() => { try { signal(started.pid, "SIGKILL"); } catch (error) { childFailures.push(error); } }, 2000);
        }
      }
      const result = await closed;
      clearTimeout(forceTimer); forceTimer = undefined;
      for (const [event, observer] of observers) {
        try { EventEmitter.prototype.removeListener.call(started, event, observer); } catch (error) { childFailures.push(error); }
      }
      if (!childFailures.length) {
        if (interrupted) childFailures.push(taskError(`Build interrupted by ${interrupted}`));
        else if (result.code !== 0 || result.signal) childFailures.push(taskError(`Workspace build failed: ${workspace.name} (${result.signal ?? result.code})`, result.code > 0 ? result.code : 1));
      }
      if (active.pid) {
        const exists = () => {
          try { host.kill(-active.pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; }
        };
        try {
          for (const value of ["SIGTERM", "SIGKILL"]) {
            if (!exists()) break;
            signal(active.pid, value);
            for (let attempt = 0; attempt < 40 && exists(); attempt++) await new Promise(resolve => setTimeout(resolve, 25));
          }
          assert.ok(!exists(), "Workspace process group did not exit");
        } catch (error) { childFailures.push(error); }
      }
      active = undefined;
      throwFailures(childFailures, "Workspace execution and cleanup failed");
      completed++;
      if (failures.length) break;
    }
  } catch (error) {
    failures.unshift(error);
  }
  clearTimeout(forceTimer);
  for (const value of registered.reverse()) {
    try { host.off(value, handlers.get(value)); } catch (error) { failures.push(error); }
  }
  throwFailures(failures, "Workspace build and cleanup failed");
  if (interrupted) throw taskError(`Build interrupted by ${interrupted}`);
  assert.equal(completed, plan.stages.length, "Incomplete workspace build");
  return { workspaces: plan.workspaces.length, builds: completed, edges: plan.edges.length, layers: plan.layers.length, noBuild: plan.noBuild, manifestless: plan.manifestless };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, "This entrypoint accepts no task filters or options");
    console.log(JSON.stringify(await buildWorkspaces(fileURLToPath(new URL("../", import.meta.url)))));
  } catch (error) {
    console.error(error);
    process.exitCode = Number.isInteger(error?.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
  }
}
