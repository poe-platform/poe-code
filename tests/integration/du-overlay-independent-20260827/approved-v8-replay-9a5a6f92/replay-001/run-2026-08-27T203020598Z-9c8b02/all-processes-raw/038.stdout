import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat as nativeStat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleRoot = resolve(process.argv[2] ?? "");
const scratchParent = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) throw new Error("usage: node verify-v5.mjs BUILT_MODULE_ROOT OWNED_SCRATCH_PARENT");
const modulePath = (...parts) => join(moduleRoot, "dist", ...parts);
const moduleUrl = (...parts) => pathToFileURL(modulePath(...parts)).href;
const loadedPaths = [
  modulePath("fs", "memory", "index.js"),
  modulePath("fs", "overlay", "index.js"),
  modulePath("fs", "readonly", "index.js"),
  modulePath("fs", "mount", "index.js"),
  modulePath("fs", "real", "index.js"),
  modulePath("commands", "du", "index.js"),
  modulePath("contracts", "index.js"),
  modulePath("shell", "index.js"),
];

const [memoryModule, overlayModule, readonlyModule, mountModule, realModule, duModule, contractsModule, shellModule] = await Promise.all([
  import(moduleUrl("fs", "memory", "index.js")),
  import(moduleUrl("fs", "overlay", "index.js")),
  import(moduleUrl("fs", "readonly", "index.js")),
  import(moduleUrl("fs", "mount", "index.js")),
  import(moduleUrl("fs", "real", "index.js")),
  import(moduleUrl("commands", "du", "index.js")),
  import(moduleUrl("contracts", "index.js")),
  import(moduleUrl("shell", "index.js")),
]);
const { createMemoryFileSystem } = memoryModule;
const { createOverlayFileSystem } = overlayModule;
const { createReadOnlyFileSystem } = readonlyModule;
const { createMountFileSystem } = mountModule;
const { createRealFileSystem } = realModule;
const { createDuCommand } = duModule;
const { FsError } = contractsModule;
const { Shell } = shellModule;

const encoder = new TextEncoder();
const harnessRoot = dirname(fileURLToPath(import.meta.url));
const environmentCases = JSON.parse(await readFile(join(harnessRoot, "..", "fixtures", "native-env-cases.json"), "utf8"));
const mutationMethods = new Set([
  "writeFile", "writeStream", "appendFile", "mkdir", "rm", "rmdir", "unlink",
  "rename", "copyFile", "link", "symlink", "chmod", "utimes", "truncate",
]);
const contentMethods = new Set(["readFile", "readStream"]);
const allowedMetadataMethods = new Set(["lstat", "stat", "readdir", "realpath", "access", "compareEntry"]);
const results = [];
const identityObjects = new WeakMap();
const identitySymbols = new Map();
let identitySequence = 0;

function scopeLabel(scope) {
  if ((typeof scope === "object" && scope !== null) || typeof scope === "function") {
    if (!identityObjects.has(scope)) identityObjects.set(scope, `object-${++identitySequence}`);
    return identityObjects.get(scope);
  }
  if (typeof scope === "symbol") {
    if (!identitySymbols.has(scope)) identitySymbols.set(scope, `symbol-${++identitySequence}`);
    return identitySymbols.get(scope);
  }
  return scope === undefined ? undefined : `${typeof scope}:${String(scope)}`;
}

function errorRecord(error) {
  if (!error) return undefined;
  return {
    name: error.name ?? typeof error,
    message: error.message ?? String(error),
    ...(error.code === undefined ? {} : { code: error.code }),
  };
}

function stableStat(stat) {
  return {
    type: stat.type,
    size: stat.size,
    ...(stat.allocatedBytes === undefined ? {} : { allocatedBytes: stat.allocatedBytes }),
    mode: stat.mode,
    atimeMs: stat.atimeMs,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    ...(stat.birthtimeMs === undefined ? {} : { birthtimeMs: stat.birthtimeMs }),
    ...(stat.identityScope === undefined ? {} : { identityScope: scopeLabel(stat.identityScope) }),
    ...(stat.ino === undefined ? {} : { ino: stat.ino }),
    ...(stat.dev === undefined ? {} : { dev: stat.dev }),
    ...(stat.nlink === undefined ? {} : { nlink: stat.nlink }),
    ...(stat.uid === undefined ? {} : { uid: stat.uid }),
    ...(stat.gid === undefined ? {} : { gid: stat.gid }),
  };
}

function observerProjection(snapshotEntries) {
  return snapshotEntries.map(entry => ({
    path: entry.path,
    type: entry.stat.type,
    ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }),
    ...(entry.target === undefined ? {} : { target: entry.target }),
  }));
}

async function measuredStats(backings, observerSnapshots) {
  const answer = {};
  for (const [name, backing] of Object.entries(backings)) {
    answer[name] = [];
    for (const entry of observerSnapshots[name]) {
      answer[name].push({ path: entry.path, stat: stableStat(await backing.lstat(entry.path)) });
    }
  }
  return answer;
}

function measuredDeltas(before, after, backingCallLabels) {
  const deltas = [];
  for (const [backing, entries] of Object.entries(before)) {
    const afterByPath = new Map(after[backing].map(entry => [entry.path, entry.stat]));
    for (const entry of entries) {
      const later = afterByPath.get(entry.path);
      for (const field of [...new Set([...Object.keys(entry.stat), ...Object.keys(later ?? {})])].sort()) {
        if (!equal(entry.stat[field], later?.[field])) {
          deltas.push({
            backing,
            layer: backingCallLabels[backing],
            path: entry.path,
            type: entry.stat.type,
            field,
            before: entry.stat[field],
            after: later?.[field],
          });
        }
      }
    }
  }
  return deltas;
}

function authorizedDirectoryAtime(delta, actionCalls) {
  return delta.field === "atimeMs" && delta.type === "directory"
    && actionCalls.some(call => call.layer === delta.layer && call.method === "readdir" && call.path === delta.path);
}

function stableIdentity(stat) {
  return {
    type: stat.type,
    size: stat.size,
    ...(stat.allocatedBytes === undefined ? {} : { allocatedBytes: stat.allocatedBytes }),
    ...(stat.identityScope === undefined ? {} : { identityScope: scopeLabel(stat.identityScope) }),
    ...(stat.dev === undefined ? {} : { dev: stat.dev }),
    ...(stat.ino === undefined ? {} : { ino: stat.ino }),
    ...(stat.nlink === undefined ? {} : { nlink: stat.nlink }),
  };
}

function instrument(base, hooks = {}, label = "layer") {
  const calls = [];
  const fs = new Proxy(base, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args) => {
        const method = String(property);
        const call = {
          sequence: calls.length,
          layer: label,
          method,
          ...(typeof args[0] === "string" ? { path: args[0] } : {}),
          ...(typeof args[1] === "string" && ["rename", "copyFile", "link"].includes(method) ? { destination: args[1] } : {}),
        };
        calls.push(call);
        const proceed = () => Reflect.apply(value, target, args);
        return hooks[method] ? hooks[method]({ args, call, proceed, target }) : proceed();
      };
    },
  });
  return { base, fs, calls, label, reset() { calls.length = 0; } };
}

function proxyWith(base, overrides) {
  return new Proxy(base, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function snapshot(fs, root = "/") {
  const entries = [];
  const visit = async path => {
    const stat = await fs.lstat(path);
    const entry = { path, stat: stableStat(stat) };
    if (stat.type === "file") entry.bytes = Buffer.from(await fs.readFile(path)).toString("base64");
    if (stat.type === "symlink" && fs.readlink) entry.target = await fs.readlink(path);
    entries.push(entry);
    if (stat.type === "directory") {
      const children = await fs.readdir(path);
      children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const child of children) await visit(`${path === "/" ? "" : path}/${child.name}`);
    }
  };
  await visit(root);
  return entries;
}

async function backingSnapshots(backings) {
  const answer = {};
  for (const [name, backing] of Object.entries(backings)) answer[name] = await snapshot(backing);
  return answer;
}

function backingProjections(snapshots) {
  return Object.fromEntries(Object.entries(snapshots)
    .map(([name, entries]) => [name, observerProjection(entries)]));
}

function policyDeltas(before, after, backingCallLabels, actionCalls) {
  const deltas = measuredDeltas(before, after, backingCallLabels);
  return {
    deltas,
    unauthorized: deltas.filter(delta => !authorizedDirectoryAtime(delta, actionCalls)),
  };
}

function equal(left, right) {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
}

function callsMatching(observers, methods) {
  return observers.flatMap(observer => observer.calls.filter(call => methods.has(call.method)));
}

function record(name, category, observation, checks, target = {}) {
  const failures = Object.entries(checks).filter(([, pass]) => !pass).map(([label]) => label);
  const id = `V5-${String(results.length + 1).padStart(3, "0")}`;
  const lineage = name.startsWith("consumer-registered pending cleanup") || name.startsWith("actual Shell lifecycle")
    ? "postfreeze-lifecycle-addition"
    : name.startsWith("real ") || name.startsWith("observer-only file read") || name.startsWith("atime field scope")
      ? "v5-observer-policy-control"
      : "historical-frozen-derived";
  const result = { id, name, category, lineage, pass: failures.length === 0, failures, target, observation };
  results.push(result);
  process.stderr.write(`${result.pass ? "ok" : "not ok"} - ${name}${failures.length ? `: ${failures.join("; ")}` : ""}\n`);
  return result;
}

async function seedLiteral(lower, upper) {
  await lower.mkdir("/holdout/sub", { recursive: true });
  await lower.writeFile("/holdout/lower-only.txt", encoder.encode("lower-only\n"));
  await lower.writeFile("/holdout/shared.txt", encoder.encode("lower-shared\n"));
  await lower.writeFile("/holdout/sub/child.bin", Uint8Array.of(0, 1, 2, 3));
  await lower.writeFile("/holdout/whiteout.txt", encoder.encode("whiteout-lower\n"));
  await upper.mkdir("/holdout", { recursive: true });
  await upper.writeFile("/holdout/shared.txt", encoder.encode("upper-shared\n"));
  await upper.writeFile("/holdout/upper-only.txt", encoder.encode("upper-only\n"));
  await upper.writeFile("/pending-source.bin", encoder.encode("pending-garbage\n"));
}

function listedNames(entries) {
  return entries.map(entry => entry.name);
}

async function missingCode(fs, path) {
  try { await fs.lstat(path); return "present"; }
  catch (error) { return error?.code ?? error?.name ?? String(error); }
}

async function executeDu(fs, args, env = {}, signal = new AbortController().signal, lifecycle = {}) {
  const stdout = [];
  const stderr = [];
  const registered = [];
  const context = {
    command: "du",
    args,
    cwd: "/",
    env,
    fs,
    signal,
    stdin: (async function* () { throw new Error("du unexpectedly read stdin"); })(),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup(cleanup) { registered.push(cleanup); lifecycle.onRegister?.(cleanup); },
  };
  try {
    const status = await createDuCommand().execute(context);
    return {
      settled: "returned", exitCode: status.exitCode,
      stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(),
      registeredCleanups: registered.length,
    };
  } catch (error) {
    return {
      settled: "rejected", error: errorRecord(error), exactReason: error === signal.reason,
      stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(),
      registeredCleanups: registered.length,
    };
  }
}

async function preparePendingFixture({ lowerHooks = {}, upperHooks = {} } = {}) {
  const lowerBase = createMemoryFileSystem();
  const upperBase = createMemoryFileSystem();
  await seedLiteral(lowerBase, upperBase);
  const state = { preparingPending: false, refused: false, pendingRoot: undefined };
  const upper = instrument(upperBase, {
    ...upperHooks,
    rm(info) {
      const [path, options = {}] = info.args;
      if (state.preparingPending && !state.refused && /^\/\.virtual-bash-overlay-[0-9a-f-]+$/u.test(path)
        && options.recursive === true && options.force === true) {
        state.refused = true;
        state.pendingRoot = path;
        throw new FsError("EACCES", { syscall: "rm", path });
      }
      return upperHooks.rm ? upperHooks.rm(info) : info.proceed();
    },
  }, "upper");
  const lower = instrument(lowerBase, lowerHooks, "lower");
  const overlay = createOverlayFileSystem({ upper: upper.fs, lower: lower.fs });
  await overlay.rm("/holdout/whiteout.txt");
  state.preparingPending = true;
  await overlay.rm("/pending-source.bin");
  state.preparingPending = false;
  assert.equal(state.refused, true, "pending fixture did not refuse the exact first forced stage cleanup");
  assert.match(state.pendingRoot, /^\/\.virtual-bash-overlay-[0-9a-f-]+$/u);
  assert.equal(await missingCode(upperBase, `${state.pendingRoot}/entry`), "present");
  upper.reset(); lower.reset();
  return {
    overlay, upper, lower, upperBase, lowerBase, state,
    observers: [upper, lower], backings: { upper: upperBase, lower: lowerBase },
    backingCallLabels: { upper: "upper", lower: "lower" },
    pendingRoot: state.pendingRoot,
    overlayHoldout: "/holdout",
    overlayRoot: "/",
    peerPaths: {
      "/holdout/shared.txt": [upper.fs, "/holdout/shared.txt"],
      "/holdout/lower-only.txt": [lower.fs, "/holdout/lower-only.txt"],
      "/holdout/sub/child.bin": [lower.fs, "/holdout/sub/child.bin"],
    },
  };
}

async function prepareOverlayOverMountFixture() {
  const upperLayerBase = createMemoryFileSystem();
  const lowerLayerBase = createMemoryFileSystem();
  await seedLiteral(lowerLayerBase, upperLayerBase);
  const upper = instrument(upperLayerBase, {}, "upper-mounted-layer");
  const lower = instrument(lowerLayerBase, {}, "lower-mounted-layer");
  const upperMount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/mnt": upper.fs } });
  const lowerMount = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/mnt": lower.fs } });
  const overlay = createOverlayFileSystem({ upper: upperMount, lower: lowerMount });
  assert.equal(overlay.capabilities.readOnly, true);
  return {
    overlay, upper, lower, upperBase: upperLayerBase, lowerBase: lowerLayerBase,
    observers: [upper, lower], backings: { upperMountedLayer: upperLayerBase, lowerMountedLayer: lowerLayerBase },
    backingCallLabels: { upperMountedLayer: "upper-mounted-layer", lowerMountedLayer: "lower-mounted-layer" },
    pendingRoot: undefined,
    overlayHoldout: "/mnt/holdout",
    overlayRoot: "/mnt",
    peerPaths: {
      "/mnt/holdout/shared.txt": [upper.fs, "/holdout/shared.txt"],
      "/mnt/holdout/lower-only.txt": [lower.fs, "/holdout/lower-only.txt"],
      "/mnt/holdout/sub/child.bin": [lower.fs, "/holdout/sub/child.bin"],
    },
  };
}

async function invariantObservation(fixture, view, viewRoot, viewHoldout) {
  const visiblePaths = [
    `${fixture.overlayHoldout}/shared.txt`,
    `${fixture.overlayHoldout}/lower-only.txt`,
    `${fixture.overlayHoldout}/sub/child.bin`,
  ];
  const identities = {};
  const comparisons = {};
  for (const path of visiblePaths) {
    identities[path] = stableIdentity(await fixture.overlay.lstat(path));
    const [peer, peerPath] = fixture.peerPaths[path];
    comparisons[path] = await fixture.overlay.compareEntry(path, peer, peerPath);
  }
  const holdoutNames = listedNames(await view.readdir(viewHoldout));
  const rootNames = listedNames(await view.readdir(viewRoot));
  return {
    identities, comparisons, holdoutNames, rootNames,
    whiteout: await missingCode(fixture.overlay, `${fixture.overlayHoldout}/whiteout.txt`),
    pendingSource: fixture.pendingRoot ? await missingCode(fixture.overlay, "/pending-source.bin") : "unsupported-not-created",
  };
}

async function metadataCase(composition, action) {
  const fixture = composition === "overlay-over-mount"
    ? await prepareOverlayOverMountFixture()
    : await preparePendingFixture();
  let view = fixture.overlay;
  let viewRoot = fixture.overlayRoot;
  let viewHoldout = fixture.overlayHoldout;
  if (composition === "readonly") view = createReadOnlyFileSystem(fixture.overlay);
  if (composition === "mount-over-overlay") {
    view = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/mnt": fixture.overlay } });
    viewRoot = "/mnt";
    viewHoldout = "/mnt/holdout";
  }
  const observerBefore = await backingSnapshots(fixture.backings);
  const invariantsBefore = await invariantObservation(fixture, view, viewRoot, viewHoldout);
  const measuredBefore = await measuredStats(fixture.backings, observerBefore);
  fixture.observers.forEach(observer => observer.reset());
  let value;
  let error;
  try {
    if (action === "stat") value = stableIdentity(await view.stat(`${viewHoldout}/shared.txt`));
    else if (action === "lstat") value = stableIdentity(await view.lstat(`${viewHoldout}/shared.txt`));
    else if (action === "readdir") value = listedNames(await view.readdir(viewHoldout));
    else if (action === "du-metadata") value = await executeDu(view, ["-b", viewHoldout]);
    else if (action === "du-pending") value = await executeDu(view, ["-ba", viewRoot]);
    else throw new Error(`unknown action ${action}`);
  } catch (caught) { error = caught; }
  const actionCalls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const measuredAfter = await measuredStats(fixture.backings, observerBefore);
  const statDeltas = measuredDeltas(measuredBefore, measuredAfter, fixture.backingCallLabels);
  const unauthorizedStatDeltas = statDeltas.filter(delta => !authorizedDirectoryAtime(delta, actionCalls));
  const observerAfter = await backingSnapshots(fixture.backings);
  const invariantsAfter = await invariantObservation(fixture, view, viewRoot, viewHoldout);
  const pendingPresent = fixture.pendingRoot
    ? await missingCode(fixture.upperBase, fixture.pendingRoot) === "present"
      && await missingCode(fixture.upperBase, `${fixture.pendingRoot}/entry`) === "present"
    : undefined;
  const mutations = actionCalls.filter(call => mutationMethods.has(call.method));
  const content = actionCalls.filter(call => contentMethods.has(call.method));
  const unexpected = actionCalls.filter(call => !mutationMethods.has(call.method)
    && !contentMethods.has(call.method) && !allowedMetadataMethods.has(call.method));
  const expectedNames = composition === "overlay-over-mount"
    ? ["lower-only.txt", "shared.txt", "sub", "upper-only.txt", "whiteout.txt"]
    : ["lower-only.txt", "shared.txt", "sub", "upper-only.txt"];
  const rendered = JSON.stringify(value);
  const target = action === "readdir" ? { names: value }
    : action.startsWith("du-") ? { settled: value?.settled, exitCode: value?.exitCode, stdout: value?.stdout, stderr: value?.stderr }
      : { stat: value };
  record(`${composition} ${action} v5 measured metadata contract`, "historical-frozen-derived", {
    pendingRoot: fixture.pendingRoot,
    pendingPresent,
    observerPhases: {
      before: Object.fromEntries(Object.entries(observerBefore).map(([name, entries]) => [name, observerProjection(entries)])),
      after: Object.fromEntries(Object.entries(observerAfter).map(([name, entries]) => [name, observerProjection(entries)])),
      beforeActionCallReset: true,
      postStatsBeforeAfterObservers: true,
    },
    measuredBefore,
    measuredAfter,
    statDeltas,
    unauthorizedStatDeltas,
    invariantsBefore,
    invariantsAfter,
    value,
    error: errorRecord(error),
    actionCalls,
    mutations,
    content,
    unexpected,
  }, {
    "operation succeeds": error === undefined && (!action.startsWith("du-") || value.exitCode === 0),
    "backing bytes and entry sets unchanged": equal(
      Object.fromEntries(Object.entries(observerBefore).map(([name, entries]) => [name, observerProjection(entries)])),
      Object.fromEntries(Object.entries(observerAfter).map(([name, entries]) => [name, observerProjection(entries)])),
    ),
    "only action-listed directory atime may change": unauthorizedStatDeltas.length === 0,
    "merged names and deterministic order remain exact": equal(invariantsBefore.holdoutNames, expectedNames)
      && equal(invariantsAfter.holdoutNames, expectedNames),
    "identities remain exact": equal(invariantsBefore.identities, invariantsAfter.identities),
    "actual-entry comparisons remain exact": equal(invariantsBefore.comparisons, invariantsAfter.comparisons),
    "no backing mutation": mutations.length === 0,
    "no content read": content.length === 0,
    "no unknown action-window call": unexpected.length === 0,
    "whiteout remains effective where supported": composition === "overlay-over-mount"
      ? invariantsAfter.whiteout === "present" : invariantsAfter.whiteout === "ENOENT",
    "pending stage and source remain hidden and intact where supported": fixture.pendingRoot === undefined
      ? true : pendingPresent === true && invariantsAfter.pendingSource === "ENOENT"
        && !rendered.includes(fixture.pendingRoot.slice(1)) && !rendered.includes("pending-source.bin"),
    "DU registered cleanup synchronously": !action.startsWith("du-") || value.registeredCleanups === 1,
  }, target);
}

for (const composition of ["direct", "readonly", "mount-over-overlay"]) {
  for (const action of ["stat", "lstat", "readdir", "du-metadata", "du-pending"]) await metadataCase(composition, action);
}
for (const action of ["stat", "lstat", "readdir", "du-metadata"]) await metadataCase("overlay-over-mount", action);

{
  const state = { inject: true };
  const fixture = await preparePendingFixture({
    lowerHooks: {
      lstat({ args, proceed }) {
        if (state.inject && args[0] === "/holdout/sub/child.bin") {
          throw new FsError("EIO", { syscall: "lstat", path: "/holdout/sub/child.bin" });
        }
        return proceed();
      },
    },
  });
  const before = await backingSnapshots(fixture.backings);
  const failureMeasuredBefore = await measuredStats(fixture.backings, before);
  fixture.observers.forEach(observer => observer.reset());
  const failure = await executeDu(fixture.overlay, ["-b", "/holdout"]);
  const failureCalls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const failureMeasuredAfter = await measuredStats(fixture.backings, before);
  const failurePolicy = policyDeltas(failureMeasuredBefore, failureMeasuredAfter, fixture.backingCallLabels, failureCalls);
  const afterFailure = await backingSnapshots(fixture.backings);
  const retryMeasuredBefore = await measuredStats(fixture.backings, afterFailure);
  state.inject = false;
  fixture.observers.forEach(observer => observer.reset());
  const retry = await executeDu(fixture.overlay, ["-b", "/holdout"]);
  const retryCalls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const retryMeasuredAfter = await measuredStats(fixture.backings, afterFailure);
  const retryPolicy = policyDeltas(retryMeasuredBefore, retryMeasuredAfter, fixture.backingCallLabels, retryCalls);
  const afterRetry = await backingSnapshots(fixture.backings);
  record("exact child lstat EIO suppresses incomplete total and retry is mutation-free", "holdout", {
    pendingRoot: fixture.pendingRoot, before, afterFailure, afterRetry,
    measuredWindows: {
      failure: { before: failureMeasuredBefore, after: failureMeasuredAfter, ...failurePolicy },
      retry: { before: retryMeasuredBefore, after: retryMeasuredAfter, ...retryPolicy },
    },
    failure, retry, failureCalls, retryCalls,
  }, {
    "exact EIO surfaced as command failure": failure.settled === "returned" && failure.exitCode === 1 && /child\.bin/u.test(failure.stderr),
    "incomplete operand total suppressed": failure.stdout === "",
    "failure leaves backing bytes and entries unchanged": equal(backingProjections(before), backingProjections(afterFailure)),
    "failure changes only action-listed directory atime": failurePolicy.unauthorized.length === 0,
    "same-fixture retry succeeds": retry.exitCode === 0
      && retry.stdout === "4\t/holdout/sub\n39\t/holdout\n" && retry.stderr === "",
    "retry leaves backing bytes and entries unchanged": equal(backingProjections(afterFailure), backingProjections(afterRetry)),
    "retry changes only action-listed directory atime": retryPolicy.unauthorized.length === 0,
    "failure and retry make no mutation/content calls": [...failureCalls, ...retryCalls]
      .every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method)),
    "pending garbage remains after failure and retry": await missingCode(fixture.upperBase, fixture.pendingRoot) === "present",
  }, { failure: { exitCode: failure.exitCode, stdout: failure.stdout, stderr: failure.stderr }, retry: { exitCode: retry.exitCode, stdout: retry.stdout, stderr: retry.stderr } });
}

async function withRealFixture(callback) {
  const root = await mkdtemp(join(scratchParent, "v5-real-observer-"));
  try {
    await writeFile(join(root, "file.bin"), new Uint8Array(1500).fill(0x61));
    const fs = await createRealFileSystem({ root });
    return await callback({ root, fs });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function forceOldAtime(path) {
  const current = await nativeStat(path);
  const requestedAtimeMs = 946684800000;
  await utimes(path, new Date(requestedAtimeMs), current.mtime);
  const forced = await nativeStat(path);
  const tick = Date.now();
  while (Date.now() === tick) await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
  return {
    requestedAtimeMs,
    originalAtimeMs: current.atimeMs,
    observedAtimeMs: forced.atimeMs,
    mtimeMs: forced.mtimeMs,
    demonstrablyOld: forced.atimeMs < current.atimeMs && forced.atimeMs < forced.mtimeMs,
  };
}

await withRealFixture(async ({ root, fs }) => {
  await forceOldAtime(root);
  const before = stableStat(await fs.lstat("/"));
  const names = listedNames(await fs.readdir("/"));
  const after = stableStat(await fs.lstat("/"));
  const deltas = measuredDeltas({ real: [{ path: "/", stat: before }] }, { real: [{ path: "/", stat: after }] }, { real: "real" });
  record("real directory listing visibly changes only directory atime", "v5-observer-policy-control", { before, after, deltas, names }, {
    "real clock and provider expose directory atime change": after.atimeMs > before.atimeMs,
    "literal entry is listed": equal(names, ["file.bin"]),
    "all recorded changes are directory atime": deltas.length === 1 && deltas[0].field === "atimeMs" && deltas[0].type === "directory",
  });
});

await withRealFixture(async ({ root, fs }) => {
  await forceOldAtime(root);
  const before = stableStat(await fs.lstat("/"));
  await fs.lstat("/");
  const after = stableStat(await fs.lstat("/"));
  record("real lstat observer is atime-stable", "v5-observer-policy-control", { before, after, deltas: measuredDeltas({ real: [{ path: "/", stat: before }] }, { real: [{ path: "/", stat: after }] }, { real: "real" }) }, {
    "lstat preserves every recorded field": equal(before, after),
  });
});

await withRealFixture(async ({ root, fs }) => {
  const file = join(root, "file.bin");
  const inventory = {
    real: [{ path: "/file.bin", stat: stableStat(await fs.lstat("/file.bin")) }],
  };
  const fileAtimeSetup = await forceOldAtime(file);
  const beforeStats = await measuredStats({ real: fs }, inventory);
  const before = beforeStats.real[0].stat;
  const bytes = await fs.readFile("/file.bin");
  const afterStats = await measuredStats({ real: fs }, inventory);
  const after = afterStats.real[0].stat;
  const deltas = measuredDeltas(beforeStats, afterStats, { real: "real" });
  record("observer-only file read visibly changes file atime outside product phase", "v5-observer-policy-control", {
    observerScope: "real-adapter observer-only read outside product phase",
    inventoryMethod: "lstat-only",
    fileAtimeSetup,
    beforeStats,
    afterStats,
    deltas,
    bytesSha256: createHash("sha256").update(bytes).digest("hex"),
  }, {
    "old file-atime fixture precondition is established": fileAtimeSetup.demonstrablyOld
      && before.atimeMs === fileAtimeSetup.observedAtimeMs && before.atimeMs < before.mtimeMs,
    "locked bytes are read": createHash("sha256").update(bytes).digest("hex") === environmentCases.fixture.sha256,
    "file atime change is visible": after.atimeMs > before.atimeMs,
    "resulting delta is exactly real file atime": deltas.length === 1
      && deltas[0].layer === "real" && deltas[0].path === "/file.bin"
      && deltas[0].field === "atimeMs" && deltas[0].type === "file",
    "all non-atime fields remain exact": Object.keys(before).filter(field => field !== "atimeMs").every(field => equal(before[field], after[field])),
  });
});

await withRealFixture(async ({ root, fs }) => {
  const observer = instrument(fs, {}, "real");
  const mutant = proxyWith(observer.fs, {
    async readdir(path, options) {
      await observer.fs.readFile("/file.bin", options);
      return observer.fs.readdir(path, options);
    },
  });
  const inventory = {
    real: [
      { path: "/", stat: stableStat(await fs.lstat("/")) },
      { path: "/file.bin", stat: stableStat(await fs.lstat("/file.bin")) },
    ],
  };
  const rootAtimeSetup = await forceOldAtime(root);
  const fileAtimeSetup = await forceOldAtime(join(root, "file.bin"));
  const beforeStats = await measuredStats({ real: fs }, inventory);
  observer.reset();
  await mutant.readdir("/");
  const actionCalls = observer.calls.map(call => ({ ...call }));
  const afterStats = await measuredStats({ real: fs }, inventory);
  const deltas = measuredDeltas(beforeStats, afterStats, { real: "real" });
  const authorized = deltas.filter(delta => authorizedDirectoryAtime(delta, actionCalls));
  const unauthorized = deltas.filter(delta => !authorizedDirectoryAtime(delta, actionCalls));
  const beforeRoot = beforeStats.real.find(entry => entry.path === "/").stat;
  const beforeFile = beforeStats.real.find(entry => entry.path === "/file.bin").stat;
  const afterFile = afterStats.real.find(entry => entry.path === "/file.bin").stat;
  record("atime field scope rejects file-read listing mutant", "negative-control", {
    rootAtimeSetup, fileAtimeSetup, beforeStats, afterStats, deltas, authorized, unauthorized, actionCalls,
  }, {
    "old file-atime fixture precondition is established": fileAtimeSetup.demonstrablyOld
      && beforeFile.atimeMs === fileAtimeSetup.observedAtimeMs,
    "old directory-atime fixture precondition is established": rootAtimeSetup.demonstrablyOld
      && beforeRoot.atimeMs === rootAtimeSetup.observedAtimeMs,
    "mutant really reads content": actionCalls.some(call => call.method === "readFile"),
    "target file atime actually changes": afterFile.atimeMs > beforeFile.atimeMs,
    "listed-directory atime is visibly and narrowly authorized": authorized.length === 1
      && authorized[0].path === "/" && authorized[0].field === "atimeMs" && authorized[0].type === "directory",
    "file atime is the sole rejected field": unauthorized.length === 1
      && unauthorized[0].path === "/file.bin" && unauthorized[0].field === "atimeMs" && unauthorized[0].type === "file",
  });
});

for (const kind of ["non-atime-stat", "byte-change", "entry-change"]) {
  await withRealFixture(async ({ fs }) => {
    const beforeEntries = await snapshot(fs);
    const beforeStats = await measuredStats({ real: fs }, { real: beforeEntries });
    const observer = instrument(fs, {}, "real");
    const mutant = proxyWith(observer.fs, {
      async readdir(path, options) {
        if (kind === "non-atime-stat") await observer.fs.chmod("/file.bin", 0o600, options);
        if (kind === "byte-change") await observer.fs.writeFile("/file.bin", encoder.encode("changed"), options);
        if (kind === "entry-change") await observer.fs.writeFile("/added.bin", Uint8Array.of(0x41), { ...options, flag: "wx" });
        return observer.fs.readdir(path, options);
      },
    });
    observer.reset();
    await mutant.readdir("/");
    const actionCalls = observer.calls.map(call => ({ ...call }));
    const afterStats = await measuredStats({ real: fs }, { real: beforeEntries });
    const afterEntries = await snapshot(fs);
    const deltas = measuredDeltas(beforeStats, afterStats, { real: "real" });
    const bytesOrEntriesChanged = !equal(observerProjection(beforeEntries), observerProjection(afterEntries));
    const unauthorized = deltas.filter(delta => !authorizedDirectoryAtime(delta, actionCalls));
    record(`real ${kind} listing mutant fails unchanged assertions`, "negative-control", { beforeEntries: observerProjection(beforeEntries), afterEntries: observerProjection(afterEntries), beforeStats, afterStats, deltas, unauthorized, actionCalls }, {
      "real mutation call observed": actionCalls.some(call => mutationMethods.has(call.method)),
      "unchanged byte/entry or non-atime stat assertion detects perturbation": bytesOrEntriesChanged || unauthorized.length > 0,
    });
  });
}

{
  const fixture = await preparePendingFixture();
  const before = await backingSnapshots(fixture.backings);
  const measuredBefore = await measuredStats(fixture.backings, before);
  fixture.observers.forEach(observer => observer.reset());
  const controller = new AbortController();
  const reason = new Error("v2-pre-abort");
  controller.abort(reason);
  const result = await executeDu(fixture.overlay, ["-b", "/holdout"], {}, controller.signal);
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const measuredAfter = await measuredStats(fixture.backings, before);
  const measuredPolicy = policyDeltas(measuredBefore, measuredAfter, fixture.backingCallLabels, calls);
  const after = await backingSnapshots(fixture.backings);
  record("exact v2 pre-abort reason is preserved", "holdout", { result, calls, before, after, measuredBefore, measuredAfter, ...measuredPolicy }, {
    "identical caller reason rejects": result.settled === "rejected" && result.exactReason === true && result.error?.message === "v2-pre-abort",
    "cleanup registered before abort observation": result.registeredCleanups === 1,
    "no backing calls": calls.length === 0,
    "backing bytes and entries unchanged": equal(backingProjections(before), backingProjections(after)),
    "lstat-only measured fields unchanged": measuredPolicy.deltas.length === 0,
    "pending garbage remains": await missingCode(fixture.upperBase, fixture.pendingRoot) === "present",
  }, { settled: result.settled, exactReason: result.exactReason, error: result.error });
}

{
  let enteredResolve;
  let releaseBarrier;
  const entered = new Promise(resolvePromise => { enteredResolve = resolvePromise; });
  const barrier = new Promise(resolvePromise => { releaseBarrier = resolvePromise; });
  const fixture = await preparePendingFixture({
    lowerHooks: {
      async lstat({ args, proceed }) {
        if (args[0] === "/holdout/sub/child.bin") {
          enteredResolve();
          await barrier;
        }
        return proceed();
      },
    },
  });
  const before = await backingSnapshots(fixture.backings);
  const measuredBefore = await measuredStats(fixture.backings, before);
  fixture.observers.forEach(observer => observer.reset());
  const controller = new AbortController();
  const reason = new Error("v2-mid-abort");
  const task = executeDu(fixture.overlay, ["-b", "/holdout"], {}, controller.signal);
  await entered;
  controller.abort(reason);
  releaseBarrier();
  const result = await task;
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const measuredAfter = await measuredStats(fixture.backings, before);
  const measuredPolicy = policyDeltas(measuredBefore, measuredAfter, fixture.backingCallLabels, calls);
  const after = await backingSnapshots(fixture.backings);
  record("exact v2 mid-traversal reason is preserved", "holdout", { result, calls, before, after, measuredBefore, measuredAfter, ...measuredPolicy }, {
    "identical caller reason rejects": result.settled === "rejected" && result.exactReason === true && result.error?.message === "v2-mid-abort",
    "exact barrier reached": calls.some(call => call.layer === "lower" && call.method === "lstat" && call.path === "/holdout/sub/child.bin"),
    "cleanup registered": result.registeredCleanups === 1,
    "no mutation or content read": calls.every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method)),
    "backing bytes and entries unchanged": equal(backingProjections(before), backingProjections(after)),
    "only action-listed directory atime may change": measuredPolicy.unauthorized.length === 0,
    "pending garbage remains": await missingCode(fixture.upperBase, fixture.pendingRoot) === "present",
  }, { settled: result.settled, exactReason: result.exactReason, error: result.error });
}

async function activeStageCase(action) {
  const lowerBase = createMemoryFileSystem();
  const upperBase = createMemoryFileSystem();
  await seedLiteral(lowerBase, upperBase);
  let stageEnteredResolve;
  let releaseStage;
  let metadataEnteredResolve;
  let releaseMetadata;
  const stageEntered = new Promise(resolvePromise => { stageEnteredResolve = resolvePromise; });
  const stageGate = new Promise(resolvePromise => { releaseStage = resolvePromise; });
  const metadataEntered = new Promise(resolvePromise => { metadataEnteredResolve = resolvePromise; });
  const metadataGate = new Promise(resolvePromise => { releaseMetadata = resolvePromise; });
  const state = { stageRoot: undefined, gateNextRootLstat: false, metadataGated: false };
  const upper = instrument(upperBase, {
    async mkdir({ args, proceed }) {
      const answer = await proceed();
      if (/^\/\.virtual-bash-overlay-[0-9a-f-]+$/u.test(args[0]) && !state.stageRoot) {
        state.stageRoot = args[0];
        stageEnteredResolve();
        await stageGate;
      }
      return answer;
    },
    async lstat({ args, proceed }) {
      if (state.gateNextRootLstat && !state.metadataGated && args[0] === "/") {
        state.metadataGated = true;
        metadataEnteredResolve();
        await metadataGate;
      }
      return proceed();
    },
  }, "upper");
  const lower = instrument(lowerBase, {}, "lower");
  const overlay = createOverlayFileSystem({ upper: upper.fs, lower: lower.fs });
  upper.reset(); lower.reset();
  const mutationTask = overlay.writeFile("/active-publish.bin", Uint8Array.of(0x41), { flag: "wx" });
  await stageEntered;
  const activeSnapshot = await backingSnapshots({ upper: upperBase, lower: lowerBase });
  const activeNames = listedNames(await upperBase.readdir("/"));
  const queuedMeasuredBefore = await measuredStats({ upper: upperBase, lower: lowerBase }, activeSnapshot);
  const callsBeforeQueue = upper.calls.length + lower.calls.length;
  let traversalSettled = false;
  const traversalTask = (action === "du" ? executeDu(overlay, ["-ba", "/"]) : overlay.readdir("/"))
    .then(value => { traversalSettled = true; return value; });
  await new Promise(resolvePromise => setImmediate(resolvePromise));
  const callsWhileQueued = upper.calls.length + lower.calls.length;
  const queuedMeasuredAfter = await measuredStats({ upper: upperBase, lower: lowerBase }, activeSnapshot);
  const queuedDeltas = measuredDeltas(queuedMeasuredBefore, queuedMeasuredAfter, { upper: "upper", lower: "lower" });
  const activeSnapshotWhileQueued = await backingSnapshots({ upper: upperBase, lower: lowerBase });
  const queuedSettledBeforeRelease = traversalSettled;
  state.gateNextRootLstat = true;
  releaseStage();
  await metadataEntered;
  await mutationTask;
  const mutationCallCounts = { upper: upper.calls.length, lower: lower.calls.length };
  const mutationAndAdmissionCalls = [...upper.calls, ...lower.calls].map(call => ({ ...call }));
  const afterMutationBeforeMetadata = await backingSnapshots({ upper: upperBase, lower: lowerBase });
  const metadataMeasuredBefore = await measuredStats(
    { upper: upperBase, lower: lowerBase }, afterMutationBeforeMetadata,
  );
  releaseMetadata();
  const traversal = await traversalTask;
  const allCalls = [...upper.calls, ...lower.calls].map(call => ({ ...call }));
  const metadataCalls = [
    ...upper.calls.slice(mutationCallCounts.upper),
    ...lower.calls.slice(mutationCallCounts.lower),
  ].map(call => ({ ...call }));
  const metadataMeasuredAfter = await measuredStats(
    { upper: upperBase, lower: lowerBase }, afterMutationBeforeMetadata,
  );
  const metadataPolicy = policyDeltas(
    metadataMeasuredBefore, metadataMeasuredAfter, { upper: "upper", lower: "lower" }, metadataCalls,
  );
  const afterTraversal = await backingSnapshots({ upper: upperBase, lower: lowerBase });

  const controlLower = createMemoryFileSystem();
  const controlUpper = createMemoryFileSystem();
  await seedLiteral(controlLower, controlUpper);
  const controlOverlay = createOverlayFileSystem({ upper: controlUpper, lower: controlLower });
  await controlOverlay.writeFile("/active-publish.bin", Uint8Array.of(0x41), { flag: "wx" });
  const control = action === "du" ? await executeDu(controlOverlay, ["-ba", "/"]) : await controlOverlay.readdir("/");
  const normalizedTraversal = action === "du"
    ? { exitCode: traversal.exitCode, stdout: traversal.stdout, stderr: traversal.stderr }
    : listedNames(traversal);
  const normalizedControl = action === "du"
    ? { exitCode: control.exitCode, stdout: control.stdout, stderr: control.stderr }
    : listedNames(control);
  record(`active mkdir-stage queues exactly one ${action} read`, "holdout", {
    stageRoot: state.stageRoot, activeNames, activeSnapshot, activeSnapshotWhileQueued,
    queuedMeasuredBefore, queuedMeasuredAfter, queuedDeltas,
    callsBeforeQueue, callsWhileQueued, traversalSettledBeforeRelease: queuedSettledBeforeRelease,
    mutationCallCounts, mutationAndAdmissionCalls, metadataCalls, allCalls,
    afterMutationBeforeMetadata, afterTraversal,
    metadataMeasuredBefore, metadataMeasuredAfter, metadataDeltas: metadataPolicy.deltas,
    unauthorizedMetadataDeltas: metadataPolicy.unauthorized,
    traversal, control,
  }, {
    "real stage root exists during paused mkdir": activeNames.includes(state.stageRoot.slice(1)),
    "queued read admits no backing call before release": callsWhileQueued === callsBeforeQueue,
    "queued read leaves backing bytes and entries unchanged before release": equal(
      backingProjections(activeSnapshot), backingProjections(activeSnapshotWhileQueued),
    ),
    "queued read changes no lstat-only measured field before release": queuedDeltas.length === 0,
    "queued read remains unsettled": queuedSettledBeforeRelease === false,
    "post-release read matches completed-first control": equal(normalizedTraversal, normalizedControl),
    "stage name remains hidden": !JSON.stringify(traversal).includes(".virtual-bash-overlay-"),
    "metadata phase makes no mutation/content call": metadataCalls.every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method)),
    "metadata phase leaves backing bytes and entries unchanged": equal(
      backingProjections(afterMutationBeforeMetadata), backingProjections(afterTraversal),
    ),
    "metadata phase changes only action-listed directory atime": metadataPolicy.unauthorized.length === 0,
    "authorized mutation publishes exact byte": Buffer.from(await upperBase.readFile("/active-publish.bin")).equals(Buffer.from("A")),
  }, normalizedTraversal);
}

await activeStageCase("readdir");
await activeStageCase("du");

{
  const fsBase = createMemoryFileSystem();
  const payload = new Uint8Array(environmentCases.fixture.length).fill(environmentCases.fixture.fillByte);
  assert.equal(createHash("sha256").update(payload).digest("hex"), environmentCases.fixture.sha256);
  const fixturePath = `/${environmentCases.fixture.name}`;
  await fsBase.writeFile(fixturePath, payload);
  const fs = instrument(fsBase, {
    async lstat({ args, proceed }) {
      const stat = await proceed();
      return args[0] === fixturePath ? { ...stat, size: environmentCases.fixture.length, allocatedBytes: 4096 } : stat;
    },
  }, "env");
  const table = [];
  const run = async testCase => {
    fs.reset();
    const args = [...testCase.args, fixturePath];
    const result = await executeDu(fs.fs, args, testCase.env);
    const calls = fs.calls.map(call => ({ ...call }));
    const expectedStdout = testCase.expect.statusClass === "success"
      ? `${testCase.expect.units}\t${fixturePath}\n` : testCase.expect.stdout;
    const pass = testCase.expect.statusClass === "success"
      ? result.exitCode === 0 && result.stdout === expectedStdout && result.stderr === testCase.expect.stderr
      : result.exitCode !== 0 && result.stdout === expectedStdout
        && /invalid.*block|block.*invalid/iu.test(result.stderr)
        && calls.length === testCase.expect.filesystemCalls;
    table.push({ ...testCase, args, expectedStdout, result, calls, pass });
  };
  for (const testCase of environmentCases.cases) await run(testCase);
  const byId = Object.fromEntries(table.map(row => [row.id, row]));
  record("literal 1500-byte three-level environment precedence table", "v5-approved-addition", { table }, {
    "every literal case matches": table.every(row => row.pass),
    "invalid and empty DU_BLOCK_SIZE block lower lookup": ["du-block-size-invalid-fallback-default", "du-block-size-empty-fallback-default"]
      .every(id => byId[id].result.stdout === byId["no-env-default"].result.stdout
        && byId[id].result.stdout !== byId["du-block-size-valid-selected"].result.stdout),
    "invalid and empty BLOCK_SIZE block lower lookup": ["block-size-invalid-fallback-default", "block-size-empty-fallback-default"]
      .every(id => byId[id].result.stdout === byId["no-env-default"].result.stdout
        && byId[id].result.stdout !== byId["block-size-valid-selected"].result.stdout),
    "invalid and empty BLOCKSIZE use default": ["blocksize-invalid-fallback-default", "blocksize-empty-fallback-default"]
      .every(id => byId[id].result.stdout === byId["no-env-default"].result.stdout
        && byId[id].result.stdout !== byId["blocksize-valid-selected"].result.stdout),
    "all successful traversals are metadata only": table.filter(row => row.result.exitCode === 0)
      .every(row => row.calls.every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method))),
  }, { table: table.map(row => ({ id: row.id, selected: row.selected, exitCode: row.result.exitCode, stdout: row.result.stdout, stderr: row.result.stderr, callCount: row.calls.length })) });
}

{
  const fixture = await preparePendingFixture();
  const before = await backingSnapshots(fixture.backings);
  fixture.observers.forEach(observer => observer.reset());
  await fixture.overlay.cleanup();
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const after = await backingSnapshots(fixture.backings);
  record("explicit cleanup removes the exact pending stage", "positive-control", { pendingRoot: fixture.pendingRoot, before, after, calls }, {
    "pending root removed": await missingCode(fixture.upperBase, fixture.pendingRoot) === "ENOENT",
    "snapshot changes": !equal(before, after),
    "upper recursive rm observed": calls.some(call => call.layer === "upper" && call.method === "rm" && call.path === fixture.pendingRoot),
  });
}

{
  const fixture = await preparePendingFixture();
  fixture.observers.forEach(observer => observer.reset());
  let registeredOverlayCleanupExecutions = 0;
  const du = createDuCommand();
  const lifecycleCommand = {
    ...du,
    async execute(context) {
      context.registerCleanup?.(async () => {
        registeredOverlayCleanupExecutions++;
        await fixture.overlay.cleanup();
      });
      return du.execute(context);
    },
  };
  const shell = new Shell({ fs: fixture.overlay });
  shell.register(lifecycleCommand);
  const result = await shell.exec("du -b /holdout");
  await shell.dispose();
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  record("consumer-registered pending cleanup runs through actual Shell lifecycle", "positive-control", {
    pendingRoot: fixture.pendingRoot,
    result,
    registeredOverlayCleanupExecutions,
    calls,
  }, {
    "DU action succeeds before lifecycle cleanup": result.exitCode === 0
      && result.stdout === "4\t/holdout/sub\n39\t/holdout\n",
    "registered overlay cleanup executes once": registeredOverlayCleanupExecutions === 1,
    "pending stage removed during Shell settlement": await missingCode(fixture.upperBase, fixture.pendingRoot) === "ENOENT",
    "exact pending root removal observed": calls.some(call => call.layer === "upper" && call.method === "rm" && call.path === fixture.pendingRoot),
  });
}

{
  const fixture = await preparePendingFixture();
  const before = await backingSnapshots(fixture.backings);
  fixture.observers.forEach(observer => observer.reset());
  await fixture.overlay.writeFile("/holdout/control.bin", Uint8Array.of(0x43), { flag: "wx" });
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const after = await backingSnapshots(fixture.backings);
  record("normal mutation cleans pending garbage then publishes exact byte", "positive-control", { pendingRoot: fixture.pendingRoot, before, after, calls }, {
    "pending stage removed first": await missingCode(fixture.upperBase, fixture.pendingRoot) === "ENOENT",
    "control byte published": Buffer.from(await fixture.overlay.readFile("/holdout/control.bin")).equals(Buffer.from("C")),
    "snapshot changes": !equal(before, after),
    "cleanup and publish mutations observed": calls.some(call => call.method === "rm" && call.path === fixture.pendingRoot)
      && calls.some(call => call.method === "writeFile") && calls.some(call => call.method === "rename"),
  });
}

{
  const fixture = await preparePendingFixture();
  fixture.observers.forEach(observer => observer.reset());
  const bytes = await fixture.overlay.readFile("/holdout/lower-only.txt");
  const contentCalls = callsMatching(fixture.observers, contentMethods);
  record("ordinary content read proves the content oracle", "positive-control", { bytes: Buffer.from(bytes).toString(), contentCalls }, {
    "literal bytes returned": Buffer.from(bytes).toString() === "lower-only\n",
    "content call observed": contentCalls.length > 0,
  });
}

async function mutantControl(kind) {
  const fixture = await preparePendingFixture();
  const before = await backingSnapshots(fixture.backings);
  const measuredBefore = await measuredStats(fixture.backings, before);
  let mutant;
  if (kind === "readdir-removal") mutant = proxyWith(fixture.overlay, {
    async readdir(path, options) {
      await fixture.upper.fs.rm(fixture.pendingRoot, { recursive: true, force: true });
      return fixture.overlay.readdir(path, options);
    },
  });
  if (kind === "content-read") mutant = proxyWith(fixture.overlay, {
    async readdir(path, options) {
      await fixture.overlay.readFile("/holdout/lower-only.txt", options);
      return fixture.overlay.readdir(path, options);
    },
  });
  if (kind === "copy-up") mutant = proxyWith(fixture.overlay, {
    async readdir(path, options) {
      await fixture.overlay.writeFile("/holdout/lower-only.txt", encoder.encode("copy-up-mutant\n"), options);
      return fixture.overlay.readdir(path, options);
    },
  });
  fixture.observers.forEach(observer => observer.reset());
  const result = await executeDu(mutant, ["-b", "/holdout"]);
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  let measuredAfter;
  let measuredAfterError;
  try { measuredAfter = await measuredStats(fixture.backings, before); }
  catch (error) { measuredAfterError = errorRecord(error); }
  const measuredPolicy = measuredAfter
    ? policyDeltas(measuredBefore, measuredAfter, fixture.backingCallLabels, calls)
    : { deltas: [], unauthorized: [] };
  const after = await backingSnapshots(fixture.backings);
  const innerFailures = [
    ...(!equal(backingProjections(before), backingProjections(after)) ? ["backing bytes and entries unchanged"] : []),
    ...(measuredAfterError ? ["lstat-only inventory remains present"] : []),
    ...(measuredPolicy.unauthorized.length > 0 ? ["only action-listed directory atime may change"] : []),
    ...(calls.some(call => mutationMethods.has(call.method)) ? ["no backing mutation"] : []),
    ...(calls.some(call => contentMethods.has(call.method)) ? ["no content read"] : []),
  ];
  record(`unchanged assertions kill ${kind} behavior mutant`, "negative-control", {
    result, before, after, measuredBefore, measuredAfter, measuredAfterError,
    statDeltas: measuredPolicy.deltas, unauthorizedStatDeltas: measuredPolicy.unauthorized,
    calls, innerFailures,
  }, {
    "real behavior perturbation is detected": innerFailures.length > 0,
    "unchanged command assertion was exercised": result.registeredCleanups === 1,
  });
}

await mutantControl("readdir-removal");
await mutantControl("content-read");
await mutantControl("copy-up");

{
  let barrierEnteredResolve;
  let releaseBarrier;
  const barrierEntered = new Promise(resolvePromise => { barrierEnteredResolve = resolvePromise; });
  const barrier = new Promise(resolvePromise => { releaseBarrier = resolvePromise; });
  const fixture = await preparePendingFixture({
    lowerHooks: {
      async lstat({ args, proceed }) {
        if (args[0] === "/holdout/sub/child.bin") {
          barrierEnteredResolve();
          await barrier;
        }
        return proceed();
      },
    },
  });
  let registeredExecutionCount = 0;
  const command = createDuCommand();
  const wrappedCommand = {
    ...command,
    async execute(context) {
      return command.execute({
        ...context,
        registerCleanup(cleanup) {
          context.registerCleanup?.(async () => {
            registeredExecutionCount++;
            await cleanup();
          });
        },
      });
    },
  };
  const shell = new Shell({ fs: fixture.overlay });
  shell.register(wrappedCommand);
  const controller = new AbortController();
  const reason = new Error("v2-shell-lifecycle-abort");
  const task = shell.exec("du -b /holdout", { signal: controller.signal });
  await barrierEntered;
  controller.abort(reason);
  releaseBarrier();
  let rejected;
  try { await task; } catch (error) { rejected = error; }
  await shell.dispose();
  record("actual Shell lifecycle runs DU registered cleanup and preserves caller reason", "holdout", {
    error: errorRecord(rejected), exactReason: rejected === reason, registeredExecutionCount,
  }, {
    "Shell rejects identical caller reason": rejected === reason,
    "registered cleanup executed by invocation scope": registeredExecutionCount === 1,
    "pending overlay garbage remains metadata-inert": await missingCode(fixture.upperBase, fixture.pendingRoot) === "present",
  }, { exactReason: rejected === reason, registeredExecutionCount });
}

const loadedFiles = [];
for (const path of loadedPaths) {
  const bytes = await readFile(path);
  loadedFiles.push({ path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const summary = {
  total: results.length,
  passed: results.filter(result => result.pass).length,
  failed: results.filter(result => !result.pass).length,
  byCategory: Object.fromEntries([...new Set(results.map(result => result.category))].map(category => [category, {
    total: results.filter(result => result.category === category).length,
    passed: results.filter(result => result.category === category && result.pass).length,
    failed: results.filter(result => result.category === category && !result.pass).length,
  }])),
  byLineage: Object.fromEntries([...new Set(results.map(result => result.lineage))].map(lineage => [lineage, {
    total: results.filter(result => result.lineage === lineage).length,
    passed: results.filter(result => result.lineage === lineage && result.pass).length,
    failed: results.filter(result => result.lineage === lineage && !result.pass).length,
  }])),
};
assert.equal(summary.byLineage["historical-frozen-derived"]?.total, 31, "fresh v5 must retain exactly 31 historical frozen-derived cases");
assert.equal(summary.byLineage["postfreeze-lifecycle-addition"]?.total, 2, "fresh v5 must retain exactly two postfreeze lifecycle additions");
assert.equal(summary.byLineage["v5-observer-policy-control"]?.total, 7, "fresh v5 must contain exactly seven observer-policy controls");
process.stdout.write(`${JSON.stringify({
  schema: 1,
  moduleRoot,
  loadedFiles,
  summary,
  parityProjection: results.map(({ id, name, category, pass, failures, target }) => ({ id, name, category, pass, failures, target })),
  results,
}, null, 2)}\n`);
process.exitCode = summary.failed === 0 ? 0 : 1;
