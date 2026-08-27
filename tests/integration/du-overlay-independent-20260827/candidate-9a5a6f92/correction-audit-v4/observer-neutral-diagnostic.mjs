import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleRoot = resolve(process.argv[2] ?? "");
const binding = process.argv[3];
const outputPath = resolve(process.argv[4] ?? "");
if (!process.argv[2] || !binding || !process.argv[4]) {
  throw new Error("usage: node observer-neutral-diagnostic.mjs MODULE_ROOT BINDING OUTPUT_JSON");
}

const modulePaths = [
  "dist/fs/memory/index.js",
  "dist/fs/overlay/index.js",
  "dist/fs/readonly/index.js",
  "dist/fs/mount/index.js",
  "dist/commands/du/index.js",
  "dist/contracts/index.js",
];
const modules = await Promise.all(modulePaths.map(async path => {
  const absolute = join(moduleRoot, path);
  const bytes = await readFile(absolute);
  return {
    path,
    absolute,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    namespace: await import(pathToFileURL(absolute).href),
  };
}));

const { createMemoryFileSystem } = modules[0].namespace;
const { createOverlayFileSystem } = modules[1].namespace;
const { createReadOnlyFileSystem } = modules[2].namespace;
const { createMountFileSystem } = modules[3].namespace;
const { createDuCommand } = modules[4].namespace;
const { FsError } = modules[5].namespace;
const encoder = new TextEncoder();
const mutationMethods = new Set([
  "writeFile", "writeStream", "appendFile", "mkdir", "rm", "rmdir", "unlink",
  "rename", "copyFile", "link", "symlink", "chmod", "utimes", "truncate",
]);
const contentMethods = new Set(["readFile", "readStream"]);
const identityObjects = new WeakMap();
const identitySymbols = new Map();
let identitySequence = 0;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

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

function statRecord(stat) {
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

function withoutAtime(value) {
  return value.map(entry => {
    const { atimeMs: _atimeMs, ...stat } = entry.stat;
    return { ...entry, stat };
  });
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorRecord(error) {
  if (!error) return undefined;
  return {
    name: error.name ?? typeof error,
    message: error.message ?? String(error),
    ...(error.code === undefined ? {} : { code: error.code }),
  };
}

function instrument(base, label, hooks = {}) {
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
          ...(typeof args[1] === "string" && ["rename", "copyFile", "link"].includes(method)
            ? { destination: args[1] } : {}),
        };
        calls.push(call);
        const proceed = () => Reflect.apply(value, target, args);
        return hooks[method] ? hooks[method]({ args, proceed, call }) : proceed();
      };
    },
  });
  return { base, fs, calls, reset() { calls.length = 0; } };
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

async function codeAt(fs, path) {
  try {
    await fs.lstat(path);
    return "present";
  } catch (error) {
    return error?.code ?? error?.name ?? String(error);
  }
}

async function preparePendingFixture() {
  const lowerBase = createMemoryFileSystem();
  const upperBase = createMemoryFileSystem();
  await seedLiteral(lowerBase, upperBase);
  const state = { preparing: false, refused: false, pendingRoot: undefined };
  const upper = instrument(upperBase, "upper", {
    rm({ args, proceed }) {
      const [path, options = {}] = args;
      if (state.preparing && !state.refused && /^\/\.virtual-bash-overlay-[0-9a-f-]+$/u.test(path)
        && options.recursive === true && options.force === true) {
        state.refused = true;
        state.pendingRoot = path;
        throw new FsError("EACCES", { syscall: "rm", path });
      }
      return proceed();
    },
  });
  const lower = instrument(lowerBase, "lower");
  const overlay = createOverlayFileSystem({ upper: upper.fs, lower: lower.fs });
  await overlay.rm("/holdout/whiteout.txt");
  state.preparing = true;
  await overlay.rm("/pending-source.bin");
  state.preparing = false;
  if (!state.refused || !state.pendingRoot) throw new Error("failed to create the refined pending-stage fixture");
  const pendingEntry = `${state.pendingRoot}/entry`;
  const fixtureState = {
    pendingRoot: state.pendingRoot,
    pendingEntry,
    pendingRootPresent: await codeAt(upperBase, state.pendingRoot),
    pendingEntryPresent: await codeAt(upperBase, pendingEntry),
    pendingSourceHidden: await codeAt(overlay, "/pending-source.bin"),
    whiteoutHidden: await codeAt(overlay, "/holdout/whiteout.txt"),
  };
  upper.reset();
  lower.reset();
  return { lowerBase, upperBase, lower, upper, overlay, ...fixtureState };
}

async function enumerateBeforePrestat(base, label) {
  const entries = [];
  const visit = async path => {
    const stat = await base.lstat(path);
    const record = { backing: label, path, type: stat.type };
    if (stat.type === "file") {
      const bytes = await base.readFile(path);
      record.bytes = bytes.byteLength;
      record.sha256 = sha256(bytes);
    }
    entries.push(record);
    if (stat.type === "directory") {
      const children = await base.readdir(path);
      for (const child of children) await visit(`${path === "/" ? "" : path}/${child.name}`);
    }
  };
  await visit("/");
  return entries;
}

async function lstatOnlySnapshot(fixture, known) {
  const result = [];
  for (const entry of known) {
    const base = entry.backing === "upper" ? fixture.upperBase : fixture.lowerBase;
    result.push({ backing: entry.backing, path: entry.path, stat: statRecord(await base.lstat(entry.path)) });
  }
  return result;
}

async function advanceClockBeyond(value) {
  let turns = 0;
  while (Date.now() <= value) {
    if (++turns > 1000) throw new Error("Date.now() did not advance for the discriminating barrier");
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
  }
  return { thresholdMs: value, observedMs: Date.now(), turns };
}

function classifyCalls(calls) {
  const mutations = calls.filter(call => mutationMethods.has(call.method));
  const contentReads = calls.filter(call => contentMethods.has(call.method));
  const directoryReads = calls.filter(call => call.method === "readdir");
  const metadataCalls = calls.filter(call => ["lstat", "stat", "realpath", "access", "compareEntry"].includes(call.method));
  const copyUpSignals = calls.filter(call => mutationMethods.has(call.method)
    || (call.layer === "lower" && contentMethods.has(call.method)));
  return {
    total: calls.length,
    mutationCount: mutations.length,
    contentReadCount: contentReads.length,
    directoryReadCount: directoryReads.length,
    metadataCallCount: metadataCalls.length,
    copyUpSignalCount: copyUpSignals.length,
    mutations,
    contentReads,
    directoryReads,
    copyUpSignals,
  };
}

function atimeChanges(before, after) {
  return before.flatMap((entry, index) => entry.stat.atimeMs === after[index].stat.atimeMs ? [] : [{
    backing: entry.backing,
    path: entry.path,
    beforeAtimeMs: entry.stat.atimeMs,
    afterAtimeMs: after[index].stat.atimeMs,
  }]);
}

async function executeDu(fs, args) {
  const stdout = [];
  const stderr = [];
  const registered = [];
  const context = {
    command: "du",
    args,
    cwd: "/",
    env: {},
    fs,
    signal: new AbortController().signal,
    stdin: (async function* () { throw new Error("du unexpectedly read stdin"); })(),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup(cleanup) { registered.push(cleanup); },
  };
  const status = await createDuCommand().execute(context);
  return {
    exitCode: status.exitCode,
    stdout: Buffer.concat(stdout).toString(),
    stderr: Buffer.concat(stderr).toString(),
    registeredCleanups: registered.length,
  };
}

function createView(fixture, composition) {
  if (composition === "direct") return { fs: fixture.overlay, holdout: "/holdout", root: "/" };
  if (composition === "readonly") {
    return { fs: createReadOnlyFileSystem(fixture.overlay), holdout: "/holdout", root: "/" };
  }
  if (composition === "mount-over-overlay") {
    return {
      fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/mnt": fixture.overlay } }),
      holdout: "/mnt/holdout",
      root: "/mnt",
    };
  }
  throw new Error(`unknown composition: ${composition}`);
}

async function measure({ id, composition = "direct", action }) {
  const fixture = await preparePendingFixture();
  const view = createView(fixture, composition);
  const enumeratedBeforePrestat = [
    ...await enumerateBeforePrestat(fixture.upperBase, "upper"),
    ...await enumerateBeforePrestat(fixture.lowerBase, "lower"),
  ];
  const known = enumeratedBeforePrestat.map(({ backing, path }) => ({ backing, path }));
  const before = await lstatOnlySnapshot(fixture, known);
  const preCapturedAtMs = Date.now();
  fixture.upper.reset();
  fixture.lower.reset();
  const clockBarrier = await advanceClockBeyond(preCapturedAtMs);
  let value;
  let error;
  try {
    if (action === "none") value = "no action";
    else if (action === "content-read-positive-control") {
      value = Buffer.from(await fixture.lower.fs.readFile("/holdout/lower-only.txt")).toString();
    } else if (action === "stat") value = statRecord(await view.fs.stat(`${view.holdout}/shared.txt`));
    else if (action === "lstat") value = statRecord(await view.fs.lstat(`${view.holdout}/shared.txt`));
    else if (action === "readdir") value = (await view.fs.readdir(view.holdout)).map(entry => ({ name: entry.name, type: entry.type }));
    else if (action === "du-metadata") value = await executeDu(view.fs, ["-b", view.holdout]);
    else if (action === "du-pending") value = await executeDu(view.fs, ["-ba", view.root]);
    else throw new Error(`unknown action: ${action}`);
  } catch (caught) {
    error = caught;
  }
  const calls = [...fixture.upper.calls, ...fixture.lower.calls]
    .map(call => ({ ...call }))
    .sort((left, right) => left.layer.localeCompare(right.layer) || left.sequence - right.sequence);
  const postActionAtMs = Date.now();
  const after = await lstatOnlySnapshot(fixture, known);
  const counters = classifyCalls(calls);
  const changedAtimes = atimeChanges(before, after);
  const otherFieldsStable = equal(withoutAtime(before), withoutAtime(after));
  const actionSucceeded = error === undefined
    && (!action.startsWith("du-") || value.exitCode === 0);
  const pendingPathsStillPresent = after.some(entry => entry.backing === "upper" && entry.path === fixture.pendingRoot)
    && after.some(entry => entry.backing === "upper" && entry.path === fixture.pendingEntry);
  return {
    id,
    composition,
    action,
    measurementKind: "post-candidate-inspection diagnostic",
    fixture: {
      pendingRoot: fixture.pendingRoot,
      pendingEntry: fixture.pendingEntry,
      pendingRootPresentBeforeMeasurement: fixture.pendingRootPresent,
      pendingEntryPresentBeforeMeasurement: fixture.pendingEntryPresent,
      pendingSourceHiddenBeforeMeasurement: fixture.pendingSourceHidden,
      whiteoutHiddenBeforeMeasurement: fixture.whiteoutHidden,
      enumeratedBeforePrestat,
    },
    timing: { preCapturedAtMs, clockBarrier, postActionAtMs },
    before,
    actionWindow: { calls, counters, value, error: errorRecord(error) },
    after,
    result: {
      actionSucceeded,
      otherStatFieldsStable: otherFieldsStable,
      atimePreserved: changedAtimes.length === 0,
      atimeChanges: changedAtimes,
      pendingPathsStillPresent,
      noMutation: counters.mutationCount === 0,
      noContentRead: counters.contentReadCount === 0,
      noCopyUpSignal: counters.copyUpSignalCount === 0,
    },
  };
}

const cases = [];
cases.push(await measure({ id: "ON-001", action: "none" }));
cases.push(await measure({ id: "ON-002", action: "content-read-positive-control" }));
for (const action of ["stat", "lstat", "readdir", "du-metadata", "du-pending"]) {
  cases.push(await measure({ id: `ON-${String(cases.length + 1).padStart(3, "0")}`, action }));
}
for (const [composition, action] of [
  ["readonly", "readdir"],
  ["readonly", "du-metadata"],
  ["mount-over-overlay", "readdir"],
  ["mount-over-overlay", "du-metadata"],
]) {
  cases.push(await measure({ id: `ON-${String(cases.length + 1).padStart(3, "0")}`, composition, action }));
}

const observer = cases[0];
const contentControl = cases[1];
const actionCases = cases.slice(2);
const integrityChecks = {
  "observer-only control leaves every full stat unchanged": observer.result.atimePreserved
    && observer.result.otherStatFieldsStable,
  "observer-only control makes no backing action-window call": observer.actionWindow.counters.total === 0,
  "clock barrier advanced on every case": cases.every(entry => entry.timing.clockBarrier.observedMs > entry.timing.preCapturedAtMs),
  "content-read control is detected and changes target atime": contentControl.actionWindow.counters.contentReadCount === 1
    && contentControl.result.atimeChanges.some(change => change.backing === "lower" && change.path === "/holdout/lower-only.txt"),
  "content-read control changes no non-atime stat field": contentControl.result.otherStatFieldsStable,
  "actual metadata/DU actions succeed": actionCases.every(entry => entry.result.actionSucceeded),
  "actual metadata/DU actions make no mutation": actionCases.every(entry => entry.result.noMutation),
  "actual metadata/DU actions make no content read": actionCases.every(entry => entry.result.noContentRead),
  "actual metadata/DU actions make no copy-up signal": actionCases.every(entry => entry.result.noCopyUpSignal),
  "actual metadata/DU actions preserve all non-atime stat fields": actionCases.every(entry => entry.result.otherStatFieldsStable),
  "pending stage paths remain present": cases.every(entry => entry.result.pendingPathsStillPresent),
};
const failedIntegrityChecks = Object.entries(integrityChecks).filter(([, pass]) => !pass).map(([name]) => name);
const output = {
  schema: 1,
  date: "2026-08-27",
  exactCandidate: "9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d",
  refinedFreeze: "8c28d7c848311372cbef5ec3e4facff546baf0a8",
  binding,
  moduleRoot,
  loadedModules: modules.map(({ path, absolute, sha256: digest }) => ({ path, absolute, sha256: digest })),
  measurementDiscipline: {
    classification: "post-candidate-inspection diagnostic; not a frozen holdout",
    fixture: "known refined pending-stage fixture",
    prePostObserver: "direct backing lstat only",
    contentAndDirectoryEnumeration: "completed before the pre-stat snapshot",
    betweenSnapshots: "only the named action; no diagnostic readFile/readdir",
    clock: "real Date.now with a barrier requiring a later millisecond; product clock unmodified",
  },
  integrityChecks,
  failedIntegrityChecks,
  cases,
  summary: {
    total: cases.length,
    observerControlStable: observer.result.atimePreserved,
    contentReadControlDetected: contentControl.result.atimeChanges.length > 0,
    actionAtimePreserved: actionCases.filter(entry => entry.result.atimePreserved).map(entry => entry.id),
    actionAtimeChanged: actionCases.filter(entry => !entry.result.atimePreserved).map(entry => entry.id),
  },
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
if (failedIntegrityChecks.length) process.exitCode = 1;
