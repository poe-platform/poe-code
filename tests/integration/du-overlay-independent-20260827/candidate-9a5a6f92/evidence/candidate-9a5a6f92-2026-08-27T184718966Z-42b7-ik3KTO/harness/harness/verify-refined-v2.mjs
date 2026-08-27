import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleRoot = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node verify-refined-v2.mjs BUILT_MODULE_ROOT");
const modulePath = (...parts) => join(moduleRoot, "dist", ...parts);
const moduleUrl = (...parts) => pathToFileURL(modulePath(...parts)).href;
const loadedPaths = [
  modulePath("fs", "memory", "index.js"),
  modulePath("fs", "overlay", "index.js"),
  modulePath("fs", "readonly", "index.js"),
  modulePath("fs", "mount", "index.js"),
  modulePath("commands", "du", "index.js"),
  modulePath("contracts", "index.js"),
  modulePath("shell", "index.js"),
];

const [memoryModule, overlayModule, readonlyModule, mountModule, duModule, contractsModule, shellModule] = await Promise.all([
  import(moduleUrl("fs", "memory", "index.js")),
  import(moduleUrl("fs", "overlay", "index.js")),
  import(moduleUrl("fs", "readonly", "index.js")),
  import(moduleUrl("fs", "mount", "index.js")),
  import(moduleUrl("commands", "du", "index.js")),
  import(moduleUrl("contracts", "index.js")),
  import(moduleUrl("shell", "index.js")),
]);
const { createMemoryFileSystem } = memoryModule;
const { createOverlayFileSystem } = overlayModule;
const { createReadOnlyFileSystem } = readonlyModule;
const { createMountFileSystem } = mountModule;
const { createDuCommand } = duModule;
const { FsError } = contractsModule;
const { Shell } = shellModule;

const encoder = new TextEncoder();
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

function equal(left, right) {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
}

function callsMatching(observers, methods) {
  return observers.flatMap(observer => observer.calls.filter(call => methods.has(call.method)));
}

function record(name, category, observation, checks, target = {}) {
  const failures = Object.entries(checks).filter(([, pass]) => !pass).map(([label]) => label);
  const result = { name, category, pass: failures.length === 0, failures, target, observation };
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
  const before = await backingSnapshots(fixture.backings);
  const invariantsBefore = await invariantObservation(fixture, view, viewRoot, viewHoldout);
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
  const beforePostObservationCallCount = actionCalls.length;
  const after = await backingSnapshots(fixture.backings);
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
  record(`${composition} ${action} refined-v2 metadata purity`, "holdout", {
    pendingRoot: fixture.pendingRoot,
    pendingPresent,
    before,
    after,
    invariantsBefore,
    invariantsAfter,
    value,
    error: errorRecord(error),
    actionCalls,
    beforePostObservationCallCount,
    mutations,
    content,
    unexpected,
  }, {
    "operation succeeds": error === undefined && (!action.startsWith("du-") || value.exitCode === 0),
    "backing snapshots unchanged": equal(before, after),
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
  fixture.observers.forEach(observer => observer.reset());
  const failure = await executeDu(fixture.overlay, ["-b", "/holdout"]);
  const failureCalls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const afterFailure = await backingSnapshots(fixture.backings);
  state.inject = false;
  fixture.observers.forEach(observer => observer.reset());
  const retry = await executeDu(fixture.overlay, ["-b", "/holdout"]);
  const retryCalls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const afterRetry = await backingSnapshots(fixture.backings);
  record("exact child lstat EIO suppresses incomplete total and retry is pure", "holdout", {
    pendingRoot: fixture.pendingRoot, before, afterFailure, afterRetry,
    failure, retry, failureCalls, retryCalls,
  }, {
    "exact EIO surfaced as command failure": failure.settled === "returned" && failure.exitCode === 1 && /child\.bin/u.test(failure.stderr),
    "incomplete operand total suppressed": failure.stdout === "",
    "failure leaves backing unchanged": equal(before, afterFailure),
    "same-fixture retry succeeds": retry.exitCode === 0
      && retry.stdout === "4\t/holdout/sub\n39\t/holdout\n" && retry.stderr === "",
    "retry leaves backing unchanged": equal(afterFailure, afterRetry),
    "failure and retry make no mutation/content calls": [...failureCalls, ...retryCalls]
      .every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method)),
    "pending garbage remains after failure and retry": await missingCode(fixture.upperBase, fixture.pendingRoot) === "present",
  }, { failure: { exitCode: failure.exitCode, stdout: failure.stdout, stderr: failure.stderr }, retry: { exitCode: retry.exitCode, stdout: retry.stdout, stderr: retry.stderr } });
}

{
  const fixture = await preparePendingFixture();
  const before = await backingSnapshots(fixture.backings);
  fixture.observers.forEach(observer => observer.reset());
  const controller = new AbortController();
  const reason = new Error("v2-pre-abort");
  controller.abort(reason);
  const result = await executeDu(fixture.overlay, ["-b", "/holdout"], {}, controller.signal);
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const after = await backingSnapshots(fixture.backings);
  record("exact v2 pre-abort reason is preserved", "holdout", { result, calls, before, after }, {
    "identical caller reason rejects": result.settled === "rejected" && result.exactReason === true && result.error?.message === "v2-pre-abort",
    "cleanup registered before abort observation": result.registeredCleanups === 1,
    "no backing calls": calls.length === 0,
    "backing unchanged": equal(before, after),
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
  fixture.observers.forEach(observer => observer.reset());
  const controller = new AbortController();
  const reason = new Error("v2-mid-abort");
  const task = executeDu(fixture.overlay, ["-b", "/holdout"], {}, controller.signal);
  await entered;
  controller.abort(reason);
  releaseBarrier();
  const result = await task;
  const calls = fixture.observers.flatMap(observer => observer.calls.map(call => ({ ...call })));
  const after = await backingSnapshots(fixture.backings);
  record("exact v2 mid-traversal reason is preserved", "holdout", { result, calls, before, after }, {
    "identical caller reason rejects": result.settled === "rejected" && result.exactReason === true && result.error?.message === "v2-mid-abort",
    "exact barrier reached": calls.some(call => call.layer === "lower" && call.method === "lstat" && call.path === "/holdout/sub/child.bin"),
    "cleanup registered": result.registeredCleanups === 1,
    "no mutation or content read": calls.every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method)),
    "backing unchanged": equal(before, after),
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
  const callsBeforeQueue = upper.calls.length + lower.calls.length;
  let traversalSettled = false;
  const traversalTask = (action === "du" ? executeDu(overlay, ["-ba", "/"]) : overlay.readdir("/"))
    .then(value => { traversalSettled = true; return value; });
  await new Promise(resolvePromise => setImmediate(resolvePromise));
  const callsWhileQueued = upper.calls.length + lower.calls.length;
  const activeSnapshotWhileQueued = await backingSnapshots({ upper: upperBase, lower: lowerBase });
  const queuedSettledBeforeRelease = traversalSettled;
  state.gateNextRootLstat = true;
  releaseStage();
  await metadataEntered;
  await mutationTask;
  const mutationAndAdmissionCalls = [...upper.calls, ...lower.calls].map(call => ({ ...call }));
  const afterMutationBeforeMetadata = await backingSnapshots({ upper: upperBase, lower: lowerBase });
  const mutationCallCount = mutationAndAdmissionCalls.length;
  releaseMetadata();
  const traversal = await traversalTask;
  const allCalls = [...upper.calls, ...lower.calls].map(call => ({ ...call }));
  const metadataCalls = allCalls.slice(mutationCallCount);
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
    callsBeforeQueue, callsWhileQueued, traversalSettledBeforeRelease: queuedSettledBeforeRelease,
    mutationAndAdmissionCalls, metadataCalls, afterMutationBeforeMetadata, afterTraversal,
    traversal, control,
  }, {
    "real stage root exists during paused mkdir": activeNames.includes(state.stageRoot.slice(1)),
    "queued read admits no backing call before release": callsWhileQueued === callsBeforeQueue,
    "queued read adds no effect before release": equal(activeSnapshot, activeSnapshotWhileQueued),
    "queued read remains unsettled": queuedSettledBeforeRelease === false,
    "post-release read matches completed-first control": equal(normalizedTraversal, normalizedControl),
    "stage name remains hidden": !JSON.stringify(traversal).includes(".virtual-bash-overlay-"),
    "metadata phase makes no mutation/content call": metadataCalls.every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method)),
    "metadata phase leaves backing unchanged": equal(afterMutationBeforeMetadata, afterTraversal),
    "authorized mutation publishes exact byte": Buffer.from(await upperBase.readFile("/active-publish.bin")).equals(Buffer.from("A")),
  }, normalizedTraversal);
}

await activeStageCase("readdir");
await activeStageCase("du");

{
  const fsBase = createMemoryFileSystem();
  await fsBase.writeFile("/env-size-1500.bin", new Uint8Array(1500).fill(0x61));
  const fs = instrument(fsBase, {
    async lstat({ args, proceed }) {
      const stat = await proceed();
      return args[0] === "/env-size-1500.bin" ? { ...stat, size: 1500, allocatedBytes: 4096 } : stat;
    },
  }, "env");
  const table = [];
  const run = async (id, args, env) => {
    fs.reset();
    const result = await executeDu(fs.fs, args, env);
    const calls = fs.calls.map(call => ({ ...call }));
    table.push({ id, args, env, result, calls });
    return { result, calls };
  };
  const empty = await run("no-env", ["/env-size-1500.bin"], {});
  const lower = await run("lower-block-size", ["/env-size-1500.bin"], { BLOCK_SIZE: "3072" });
  const invalid = await run("invalid-selected", ["/env-size-1500.bin"], { DU_BLOCK_SIZE: "invalid-value", BLOCK_SIZE: "3072" });
  const selectedEmpty = await run("empty-selected", ["/env-size-1500.bin"], { DU_BLOCK_SIZE: "", BLOCK_SIZE: "3072" });
  const strictInvalid = await run("strict-invalid", ["-B", "invalid-value", "/env-size-1500.bin"], {});
  const explicit = await run("explicit-valid", ["-B3072", "/env-size-1500.bin"], { DU_BLOCK_SIZE: "invalid-value", BLOCK_SIZE: "1024" });
  record("exact 1500-byte DU_BLOCK_SIZE table", "holdout", { table }, {
    "no-env exact output": empty.result.exitCode === 0 && empty.result.stdout === "4\t/env-size-1500.bin\n" && empty.result.stderr === "",
    "lower BLOCK_SIZE exact output": lower.result.exitCode === 0 && lower.result.stdout === "2\t/env-size-1500.bin\n" && lower.result.stderr === "",
    "invalid selected uses default not lower": invalid.result.exitCode === 0 && invalid.result.stdout === empty.result.stdout && invalid.result.stdout !== lower.result.stdout,
    "empty selected uses default not lower": selectedEmpty.result.exitCode === 0 && selectedEmpty.result.stdout === empty.result.stdout && selectedEmpty.result.stdout !== lower.result.stdout,
    "explicit invalid fails before filesystem": strictInvalid.result.exitCode !== 0 && strictInvalid.result.stdout === "" && strictInvalid.calls.length === 0,
    "explicit valid wins and uses 3072": explicit.result.exitCode === 0 && explicit.result.stdout === lower.result.stdout,
    "all successful traversals are metadata only": table.filter(row => row.result.exitCode === 0)
      .every(row => row.calls.every(call => !mutationMethods.has(call.method) && !contentMethods.has(call.method))),
  }, { table: table.map(row => ({ id: row.id, exitCode: row.result.exitCode, stdout: row.result.stdout, stderr: row.result.stderr, callCount: row.calls.length })) });
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
  const after = await backingSnapshots(fixture.backings);
  const innerFailures = [
    ...(!equal(before, after) ? ["backing snapshots unchanged"] : []),
    ...(calls.some(call => mutationMethods.has(call.method)) ? ["no backing mutation"] : []),
    ...(calls.some(call => contentMethods.has(call.method)) ? ["no content read"] : []),
  ];
  record(`unchanged purity assertions kill ${kind} behavior mutant`, "negative-control", { result, before, after, calls, innerFailures }, {
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
};
process.stdout.write(`${JSON.stringify({
  schema: 1,
  moduleRoot,
  loadedFiles,
  summary,
  parityProjection: results.map(({ name, category, pass, failures, target }) => ({ name, category, pass, failures, target })),
  results,
}, null, 2)}\n`);
process.exitCode = summary.failed === 0 ? 0 : 1;
