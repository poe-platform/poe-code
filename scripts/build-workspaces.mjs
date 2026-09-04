import assert from "node:assert/strict";
import { execFileSync, spawn as spawnChild } from "node:child_process";
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
  return { root, rootManifest, configuration, workspaces, edges, layers, stages, manifestless, noBuild: workspaces.filter(workspace => workspace.build === null).map(workspace => ({ name: workspace.name, path: workspace.path, status: "NO_DECLARED_BUILD_NOT_A_PASS" })) };
}

function taskError(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

function validateEnvironment(environment) {
  assert.ok(environment.npm_execpath && path.isAbsolute(environment.npm_execpath), "Run this entrypoint through npm run build or npm test");
  for (const [name, value] of Object.entries(environment)) {
    if (["npm_config_ignore_scripts", "npm_config_if_present", "npm_config_include_workspace_root"].includes(name.toLowerCase())) {
      assert.ok(value === undefined || value === "false", 'Unsupported lifecycle or workspace option: ' + name);
    }
  }
}

function selectBuildStages(plan, roots) {
  const names = new Set(plan.workspaces.map(workspace => workspace.name));
  const selected = new Set();
  const visit = name => {
    assert.ok(names.has(name), 'Unknown literal workspace: ' + name);
    if (selected.has(name)) return;
    selected.add(name);
    for (const edge of plan.edges) if (edge.from === name) visit(edge.to);
  };
  for (const name of roots) visit(name);
  return { stages: plan.stages.filter(stage => selected.has(stage.name)), noBuild: plan.noBuild.filter(stage => selected.has(stage.name)) };
}

export function createWorkspaceTestPlan(rootDirectory, options = {}) {
  const { fileSystem = fs, excludeWorkspace, concurrency = 1, testArguments = [], ciGroup } = options;
  assert.ok(concurrency === 1 || concurrency === 4, "Unit concurrency must be 1 or 4");
  assert.ok(excludeWorkspace === undefined || excludeWorkspace === "virtual-bash", "Only the Node20 virtual-bash exclusion is supported");
  assert.ok(Array.isArray(testArguments) && testArguments.every(value => typeof value === "string" && !value.includes("\0")), "Invalid test arguments");
  assert.ok(ciGroup === undefined || ciGroup === "fresh" || ciGroup === "cached", "Invalid CI unit group");
  assert.ok(ciGroup === undefined || (!excludeWorkspace && !testArguments.length), "CI unit groups do not accept exclusions or test arguments");
  const plan = createWorkspaceBuildPlan(rootDirectory, fileSystem);
  let cacheable;
  if (ciGroup !== undefined) {
    const policy = readManifest(path.join(plan.root, "scripts"), "ci-unit-cache.json", fileSystem);
    assert.ok(policy && Object.keys(policy).length === 1 && Array.isArray(policy.workspaces) && policy.workspaces.length, "Invalid CI cache policy");
    cacheable = new Set(policy.workspaces);
    assert.equal(cacheable.size, policy.workspaces.length, "Duplicate CI cache admission");
    for (const name of cacheable) {
      const workspace = plan.workspaces.find(candidate => candidate.name === name);
      const scripts = workspace?.manifest.scripts ?? {};
      const commands = ["", "--config vitest.config.ts "].flatMap(config => {
        const command = `cd ../.. && vitest run ${config}${workspace?.path}/src`;
        return [command, `${command}/`];
      });
      assert.ok(name !== "virtual-bash" && workspace && commands.includes(scripts["test:unit"])
        && scripts["pretest:unit"] === undefined && scripts["posttest:unit"] === undefined, `Workspace is not cacheable: ${name}`);
    }
  }
  const names = new Set(plan.workspaces.map(workspace => workspace.name));
  if (excludeWorkspace) assert.ok(names.has(excludeWorkspace), "Excluded workspace is missing");
  const tasks = plan.configuration.tasks;
  for (const [name, task] of Object.entries(tasks)) {
    if (name !== "test:unit" && !name.endsWith("#test:unit")) continue;
    assert.ok(name === "test:unit" || name === "//#test:unit" || names.has(name.slice(0, -10)), 'Unknown unit task override: ' + name);
    assert.ok(task && typeof task === "object" && !Array.isArray(task));
    assert.ok(Object.keys(task).every(key => ["dependsOn", "inputs", "outputs", "cache"].includes(key)), 'Unsupported unit task configuration: ' + name);
    for (const field of ["dependsOn", "inputs", "outputs"]) {
      if (task[field] !== undefined) assert.ok(Array.isArray(task[field]) && task[field].every(value => typeof value === "string"), 'Invalid unit ' + field);
    }
    if (task.dependsOn !== undefined) {
      assert.ok(task.dependsOn.every(value => value === "build" || value === "^build"), 'Unsupported unit dependencies: ' + name);
      assert.equal(new Set(task.dependsOn).size, task.dependsOn.length, "Duplicate unit dependencies");
    }
    if (task.cache !== undefined) assert.equal(typeof task.cache, "boolean");
  }
  const candidates = [{ name: plan.rootManifest.name, path: null, manifest: plan.rootManifest }, ...plan.workspaces];
  const testStages = [], noTest = [], buildRoots = new Set();
  for (const workspace of candidates) {
    const scripts = workspace.manifest.scripts ?? {};
    assert.ok(scripts && typeof scripts === "object" && !Array.isArray(scripts));
    for (const event of ["pretest:unit", "test:unit", "posttest:unit"]) {
      if (scripts[event] !== undefined) assert.ok(typeof scripts[event] === "string" && scripts[event].trim().length > 0, 'Invalid ' + event + ': ' + workspace.name);
    }
    if (workspace.path === null) assert.ok(scripts["test:unit"], "Root test:unit is required");
    if (!scripts["test:unit"]) { noTest.push({ name: workspace.name, path: workspace.path, status: "NO_DECLARED_TEST_NOT_A_PASS" }); continue; }
    const id = workspace.path === null ? "//#test:unit" : workspace.name + "#test:unit";
    const settings = { ...tasks["test:unit"], ...tasks[id] };
    if (workspace.path === null) assert.ok(!settings.dependsOn?.length, "Root test build dependencies are unsupported");
    if (workspace.name === excludeWorkspace && workspace.path !== null) continue;
    if (ciGroup !== undefined && (workspace.name === "virtual-bash" || cacheable.has(workspace.name) !== (ciGroup === "cached"))) continue;
    testStages.push({ id, name: workspace.name, path: workspace.path, event: "test:unit" });
    for (const dependency of settings.dependsOn ?? []) {
      if (dependency === "build") buildRoots.add(workspace.name);
      else for (const edge of plan.edges) if (edge.from === workspace.name) buildRoots.add(edge.to);
    }
  }
  const selected = selectBuildStages(plan, buildRoots);
  return { ...plan, buildStages: selected.stages, buildNoBuild: selected.noBuild, testStages, noTest, concurrency, testArguments, excludeWorkspace, ...(ciGroup === undefined ? {} : { ciGroup }) };
}

function taskEnvironment(environment, stage, unitMode) {
  const selected = { ...environment };
  if (unitMode && !(stage.path !== null && stage.name === "virtual-bash" && stage.event === "test:unit")) {
    for (const name of ["SAFEJS_LOCAL_ROOT", "S3_HTTP_EXPORTS_REVISION", "FULL_GATE_ROOT", "SAFE_BASH_TEST_SHARD", "SAFE_BASH_TEST_CONCURRENCY"]) delete selected[name];
  }
  return selected;
}

async function executeStages(plan, { environment, spawn, host, concurrency = 1, unitMode = false, testArguments = [] }) {
  assert.equal(host.platform === "win32", false, "Workspace process-group cleanup currently supports POSIX hosts");
  const active = new Set(), registered = [], failures = [];
  const remember = (context, error) => { context?.errors.push(error); failures.push(error); };
  let interrupted, failed = false, next = 0, completed = 0;
  const signal = (pid, value) => {
    try { host.kill(-pid, value); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  };
  const terminate = (context, value) => {
    if (!context.child?.pid || context.stopped || context.exited) return;
    context.stopped = true;
    context.forceTimer = setTimeout(() => {
      try { signal(context.child.pid, "SIGKILL"); } catch (error) { remember(context, error); }
    }, 2000);
    try { signal(context.child.pid, value); } catch (error) { remember(context, error); }
  };
  const failure = () => {
    failed = true;
    if (unitMode || concurrency > 1) for (const owned of active) terminate(owned, "SIGTERM");
  };
  const stop = value => {
    if (!interrupted) {
      interrupted = value;
      if (!failed) failures.push(taskError('Build or unit execution interrupted by ' + value));
      failed = true;
    }
    for (const context of active) terminate(context, value);
  };
  const handlers = new Map(["SIGINT", "SIGTERM"].map(value => [value, () => stop(value)]));
  const run = async stage => {
    const context = { stage, child: undefined, stopped: false, errors: [], forceTimer: undefined };
    active.add(context);
    const event = stage.event ?? "build";
    const selection = stage.path === null ? ["--workspaces=false"] : ['--workspace=' + stage.path, "--include-workspace-root=false"];
    const args = [environment.npm_execpath, "--prefix", plan.root, "run", event, ...selection, "--if-present=false"];
    const forwardedArguments = event === "test:unit" ? testArguments : stage.testArguments ?? [];
    if (forwardedArguments.length) args.push("--", ...forwardedArguments);
    let resolveClose;
    const closed = new Promise(resolve => { resolveClose = resolve; });
    const onError = error => { remember(context, error); failure(); };
    const onClose = (code, receivedSignal) => {
      context.exited = true;
      if (!context.errors.length && !context.stopped && (code !== 0 || receivedSignal)) {
        remember(context, taskError('Workspace ' + event + ' failed: ' + stage.name + ' (' + (receivedSignal ?? code) + ')', code > 0 ? code : 1));
        failure();
      }
      resolveClose({ code, signal: receivedSignal });
    };
    const observers = [["close", onClose], ["error", onError]];
    try {
      try {
        context.child = spawn(host.execPath, args, { cwd: plan.root, env: taskEnvironment(environment, { ...stage, event }, unitMode), stdio: "inherit", detached: true });
      } catch (error) {
        remember(context, error); failure(); return;
      }
      const started = context.child;
      try {
        for (const [eventName, observer] of observers) started.once(eventName, observer);
      } catch (error) {
        remember(context, error);
        for (const [eventName, observer] of observers) {
          EventEmitter.prototype.removeListener.call(started, eventName, observer);
          EventEmitter.prototype.on.call(started, eventName, observer);
        }
        failure();
        terminate(context, "SIGTERM");
      }
      if (interrupted || (failed && (unitMode || concurrency > 1))) terminate(context, "SIGTERM");
      await closed;
      clearTimeout(context.forceTimer);
      context.forceTimer = undefined;
      for (const [eventName, observer] of observers) {
        try { EventEmitter.prototype.removeListener.call(started, eventName, observer); } catch (error) { remember(context, error); failure(); }
      }
      if (started.pid) {
        const exists = () => {
          try { host.kill(-started.pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; }
        };
        try {
          for (const value of ["SIGTERM", "SIGKILL"]) {
            if (!exists()) break;
            signal(started.pid, value);
            for (let attempt = 0; attempt < 40 && exists(); attempt++) await new Promise(resolve => setTimeout(resolve, 25));
          }
          assert.ok(!exists(), "Workspace process group did not exit");
        } catch (error) { remember(context, error); failure(); }
      }
      if (!context.errors.length && !context.stopped) completed++;
    } finally {
      clearTimeout(context.forceTimer);
      active.delete(context);
    }
  };
  const work = async () => {
    while (!failed && next < plan.stages.length) {
      const stage = plan.stages[next++];
      await run(stage);
    }
  };
  try {
    for (const [value, handler] of handlers) { registered.push(value); host.on(value, handler); }
    const workers = Array.from({ length: concurrency }, () => work().catch(error => {
      failures.push(error); failed = true;
      for (const context of active) terminate(context, "SIGTERM");
    }));
    await Promise.all(workers);
  } catch (error) { failures.push(error); failed = true; }
  for (const value of registered.reverse()) {
    try { host.off(value, handlers.get(value)); } catch (error) { failures.push(error); }
  }
  throwFailures(failures, "Workspace execution and cleanup failed");
  assert.equal(completed, plan.stages.length, "Incomplete workspace execution");
  return completed;
}

export async function buildWorkspaces(rootDirectory, options = {}) {
  const { environment = process.env, spawn = spawnChild, host = process, fileSystem = fs, workspace, concurrency = 2 } = options;
  assert.ok(concurrency === 1 || concurrency === 2, "Build concurrency must be 1 or 2");
  validateEnvironment(environment);
  const plan = createWorkspaceBuildPlan(rootDirectory, fileSystem);
  const selected = workspace === undefined ? plan : { ...plan, ...selectBuildStages(plan, [workspace]) };
  let completed = 0;
  for (const layer of plan.layers) {
    const names = new Set(layer);
    const stages = selected.stages.filter(stage => names.has(stage.name));
    if (stages.length) completed += await executeStages({ ...selected, stages }, { environment, spawn, host, concurrency });
  }
  return { workspaces: plan.workspaces.length, builds: completed, edges: plan.edges.length, layers: plan.layers.length, noBuild: selected.noBuild, manifestless: plan.manifestless };
}

export async function testWorkspaces(rootDirectory, options = {}) {
  const { environment = process.env, spawn = spawnChild, host = process, fileSystem = fs, excludeWorkspace, concurrency = 1, testArguments = [], ciGroup } = options;
  validateEnvironment(environment);
  const plan = createWorkspaceTestPlan(rootDirectory, { fileSystem, excludeWorkspace, concurrency, testArguments, ciGroup });
  let testStages = plan.testStages;
  if (plan.rootManifest.scripts["test:unit:shared"]) {
    const { sharedVitestStages } = await import("./test-vitest-workspaces.mjs");
    testStages = sharedVitestStages(plan, fileSystem);
  }
  const childEnvironment = { ...environment };
  const localGitVariables = execFileSync("git", ["rev-parse", "--local-env-vars"], {
    cwd: plan.root,
    env: { PATH: environment.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    encoding: "utf8", timeout: 10000, maxBuffer: 65536
  }).trim().split("\n");
  assert.ok(localGitVariables.every(name => name.startsWith("GIT_") && [...name].every(character => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(character))), "Invalid Git local environment names");
  for (const name of localGitVariables) delete childEnvironment[name];
  const builds = await executeStages({ ...plan, stages: plan.buildStages }, { environment: childEnvironment, spawn, host, unitMode: true });
  await executeStages({ ...plan, stages: testStages }, { environment: childEnvironment, spawn, host, unitMode: true, concurrency, testArguments });
  return { workspaces: plan.workspaces.length, builds, tests: plan.testStages.length, concurrency, cache: "UNCACHED", excluded: excludeWorkspace ? [excludeWorkspace] : [], noTest: plan.noTest, noBuild: plan.buildNoBuild, manifestless: plan.manifestless };
}

export function parseWorkspaceArguments(args) {
  if (!args.length) return { mode: "build" };
  if (args[0] !== "--test-unit") {
    const result = { mode: "build" };
    for (const argument of args) {
      if (argument.startsWith("--concurrency=")) {
        assert.ok(!Object.hasOwn(result, "concurrency"), "Duplicate build concurrency");
        const value = argument.slice("--concurrency=".length);
        assert.ok(value === "1" || value === "2", "Build concurrency must be 1 or 2");
        result.concurrency = Number(value);
      } else {
        assert.ok(argument.startsWith("--workspace=") && !Object.hasOwn(result, "workspace"), "Unsupported build argument");
        const workspace = argument.slice(12);
        assert.ok(workspace && !["*", "?", "[", "]", "{", "}", "\\", "\0", ".."].some(value => workspace.includes(value)), "Invalid literal workspace selector");
        result.workspace = workspace;
      }
    }
    return result;
  }
  const result = { mode: "test-unit", concurrency: 1, excludeWorkspace: undefined, testArguments: [] };
  const seen = new Set();
  for (let index = 1; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") { result.testArguments.push(...args.slice(index + 1)); break; }
    const equals = argument.indexOf("=");
    const name = equals < 0 ? argument : argument.slice(0, equals);
    if (name === "--concurrency" || name === "--exclude-workspace" || name === "--ci-group") {
      assert.ok(!seen.has(name), "Duplicate runner option"); seen.add(name);
      const value = equals < 0 ? undefined : argument.slice(equals + 1);
      if (name === "--concurrency") { assert.ok(value === "1" || value === "4", "Unit concurrency must be 1 or 4"); result.concurrency = Number(value); }
      else if (name === "--ci-group") { assert.ok(value === "fresh" || value === "cached", "Invalid CI unit group"); result.ciGroup = value; }
      else { assert.equal(value, "virtual-bash", "Only the Node20 virtual-bash exclusion is supported"); result.excludeWorkspace = value; }
    } else {
      assert.ok(!["--workspace", "--test-unit"].includes(name), "Unsupported unit runner option");
      result.testArguments.push(...args.slice(index)); break;
    }
  }
  assert.ok(result.ciGroup === undefined || (!result.excludeWorkspace && !result.testArguments.length), "CI unit groups do not accept exclusions or test arguments");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseWorkspaceArguments(process.argv.slice(2));
    const root = fileURLToPath(new URL("../", import.meta.url));
    console.log(JSON.stringify(await (options.mode === "test-unit" ? testWorkspaces(root, options) : buildWorkspaces(root, options))));
  } catch (error) {
    console.error(error);
    process.exitCode = Number.isInteger(error?.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
  }
}
