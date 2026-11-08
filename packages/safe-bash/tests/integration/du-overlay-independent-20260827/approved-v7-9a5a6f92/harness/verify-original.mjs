import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const extractedRoot = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node verify.mjs EXTRACTED_COMMITTED_ROOT");
const moduleUrl = (...parts) => pathToFileURL(join(extractedRoot, "dist", ...parts)).href;

const [{ createMemoryFileSystem }, { createOverlayFileSystem }, { createReadOnlyFileSystem },
  { createMountFileSystem }, { createDuCommand }, { FsError }] = await Promise.all([
  import(moduleUrl("fs", "memory", "index.js")),
  import(moduleUrl("fs", "overlay", "index.js")),
  import(moduleUrl("fs", "readonly", "index.js")),
  import(moduleUrl("fs", "mount", "index.js")),
  import(moduleUrl("commands", "du", "index.js")),
  import(moduleUrl("contracts", "index.js")),
]);

const mutationMethods = new Set([
  "writeFile", "appendFile", "writeStream", "mkdir", "rm", "unlink", "rmdir",
  "rename", "copyFile", "symlink", "link", "chmod", "utimes", "truncate",
]);
const contentMethods = new Set(["readFile", "readStream"]);
const encoder = new TextEncoder();
const results = [];
const identityObjects = new WeakMap();
const identitySymbols = new Map();
let nextIdentity = 1;

function identityLabel(scope) {
  if ((typeof scope === "object" && scope !== null) || typeof scope === "function") {
    let label = identityObjects.get(scope);
    if (!label) { label = `object-${nextIdentity++}`; identityObjects.set(scope, label); }
    return label;
  }
  if (typeof scope === "symbol") {
    let label = identitySymbols.get(scope);
    if (!label) { label = `symbol-${nextIdentity++}`; identitySymbols.set(scope, label); }
    return label;
  }
  return scope === undefined ? undefined : `${typeof scope}:${String(scope)}`;
}

function errorRecord(error) {
  if (!error) return undefined;
  return {
    name: error.name ?? typeof error,
    message: error.message ?? String(error),
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error === error?.signal?.reason ? { exactAbortReason: true } : {}),
  };
}

function instrument(base, hooks = {}) {
  const calls = [];
  const fs = new Proxy(base, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof value !== "function") return value;
    return (...args) => {
      const method = String(property);
      calls.push({ method, path: typeof args[0] === "string" ? args[0] : undefined });
      const proceed = () => Reflect.apply(value, target, args);
      return hooks[method] ? hooks[method]({ args, method, proceed, target }) : proceed();
    };
  } });
  return { base, fs, calls, reset() { calls.length = 0; } };
}

function proxyWith(base, overrides) {
  return new Proxy(base, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return overrides[property];
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function stableStat(stat) {
  return {
    type: stat.type, size: stat.size,
    ...(stat.allocatedBytes === undefined ? {} : { allocatedBytes: stat.allocatedBytes }),
    mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
    ...(stat.birthtimeMs === undefined ? {} : { birthtimeMs: stat.birthtimeMs }),
    ...(stat.identityScope === undefined ? {} : { identityScope: identityLabel(stat.identityScope) }),
    ...(stat.ino === undefined ? {} : { ino: stat.ino }),
    ...(stat.dev === undefined ? {} : { dev: stat.dev }),
    ...(stat.nlink === undefined ? {} : { nlink: stat.nlink }),
    ...(stat.uid === undefined ? {} : { uid: stat.uid }),
    ...(stat.gid === undefined ? {} : { gid: stat.gid }),
  };
}

async function snapshot(fs, root = "/") {
  const entries = [];
  const visit = async path => {
    const stat = await fs.lstat(path);
    const item = { path, stat: stableStat(stat) };
    if (stat.type === "file") item.bytes = Buffer.from(await fs.readFile(path)).toString("base64");
    if (stat.type === "symlink" && fs.readlink) item.target = await fs.readlink(path);
    entries.push(item);
    if (stat.type === "directory") {
      for (const child of await fs.readdir(path)) {
        await visit(`${path === "/" ? "" : path}/${child.name}`);
      }
    }
  };
  await visit(root);
  return entries;
}

async function snapshots(backings) {
  const answer = {};
  for (const [name, fs] of Object.entries(backings)) answer[name] = await snapshot(fs);
  return answer;
}

function same(left, right) {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
}

function callsOf(observers, methods) {
  return observers.flatMap(({ calls }, layer) => calls
    .filter(call => methods.has(call.method)).map(call => ({ layer, ...call })));
}

function record(name, category, observation, checks) {
  const failures = Object.entries(checks).filter(([, pass]) => !pass).map(([label]) => label);
  const result = { name, category, pass: failures.length === 0, failures, observation };
  results.push(result);
  process.stderr.write(`${result.pass ? "ok" : "not ok"} - ${name}${failures.length ? `: ${failures.join("; ")}` : ""}\n`);
  return result;
}

async function missingCode(fs, path) {
  try { await fs.lstat(path); return "present"; }
  catch (error) { return error?.code ?? error?.name ?? String(error); }
}

function identity(stat) {
  return {
    type: stat.type, size: stat.size,
    ...(stat.allocatedBytes === undefined ? {} : { allocatedBytes: stat.allocatedBytes }),
    identityScope: identityLabel(stat.identityScope), ino: stat.ino, dev: stat.dev, nlink: stat.nlink,
  };
}

async function seedStandard(lower, upper) {
  await lower.mkdir("/holdout/sub", { recursive: true });
  await lower.writeFile("/holdout/lower-only.txt", encoder.encode("lower-only\n"));
  await lower.writeFile("/holdout/shared.txt", encoder.encode("lower-shared\n"));
  await lower.writeFile("/holdout/sub/child.bin", new Uint8Array([0, 1, 2, 3]));
  await upper.mkdir("/holdout", { recursive: true });
  await upper.writeFile("/holdout/shared.txt", encoder.encode("upper-shared\n"));
  await upper.writeFile("/holdout/upper-only.txt", encoder.encode("upper-only\n"));
}

async function fixture({ whiteout = true, pending = true, lowerTransform } = {}) {
  const lowerBase = createMemoryFileSystem();
  const upperBase = createMemoryFileSystem();
  await seedStandard(lowerBase, upperBase);
  const extras = {};
  const lowerBackend = lowerTransform ? await lowerTransform(lowerBase, extras) : lowerBase;
  const state = { denyCleanup: true, failReaddir: false, midAbort: undefined, abortPath: undefined };
  const upper = instrument(upperBase, {
    rm({ proceed }) {
      if (state.denyCleanup) throw new FsError("EACCES", { syscall: "rm" });
      return proceed();
    },
    async readdir({ args, proceed }) {
      if (state.failReaddir && args[0] === "/holdout") throw new FsError("EIO", { syscall: "readdir", path: args[0] });
      const answer = await proceed();
      if (state.midAbort && args[0] === state.abortPath && !state.midAbort.signal.aborted) {
        state.midAbort.abort(new Error("mid-traversal-holdout-abort"));
      }
      return answer;
    },
  });
  const lower = instrument(lowerBackend);
  const overlay = createOverlayFileSystem({ upper: upper.fs, lower: lower.fs });
  if (whiteout) await overlay.rm("/holdout/lower-only.txt");
  if (pending) await overlay.mkdir("/holdout/published");
  state.denyCleanup = false;
  const pendingRoot = (await upperBase.readdir("/"))
    .map(entry => entry.name).find(name => name.startsWith(".virtual-bash-overlay-"));
  if (pending && !pendingRoot) throw new Error("failed to prepare pending overlay garbage");
  upper.reset(); lower.reset();
  return {
    overlay, upper, lower, upperBase, lowerBase, state, pendingRoot,
    observers: [upper, lower], backings: { upper: upperBase, lower: lowerBase, ...extras },
  };
}

async function executeDu(fs, args, env = {}, signal = new AbortController().signal) {
  const stdout = [], stderr = [];
  const context = {
    command: "du", args, cwd: "/", env, fs, signal,
    stdin: (async function* () { throw new Error("DU read stdin"); })(),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
  };
  try {
    const status = await createDuCommand().execute(context);
    return { settled: "returned", exitCode: status.exitCode,
      stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  } catch (error) {
    return { settled: "rejected", error: errorRecord(error), exactReason: error === signal.reason,
      stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
  }
}

async function observePurity(name, makeView, operation, { listing = false, du = false } = {}) {
  const f = await fixture();
  const { fs, path } = await makeView(f);
  const before = await snapshots(f.backings);
  const identityBefore = identity(await f.overlay.lstat("/holdout/shared.txt"));
  const comparisonBefore = await f.overlay.compareEntry("/holdout/shared.txt", f.overlay, "/holdout/shared.txt");
  f.upper.reset(); f.lower.reset();
  let value, error;
  try { value = await operation(fs, path); } catch (caught) { error = caught; }
  const identityAfter = identity(await f.overlay.lstat("/holdout/shared.txt"));
  const comparisonAfter = await f.overlay.compareEntry("/holdout/shared.txt", f.overlay, "/holdout/shared.txt");
  const whiteoutAfter = await missingCode(f.overlay, "/holdout/lower-only.txt");
  const after = await snapshots(f.backings);
  const mutations = callsOf(f.observers, mutationMethods);
  const content = callsOf(f.observers, contentMethods);
  const pendingAfter = (await f.upperBase.readdir("/")).some(entry => entry.name === f.pendingRoot);
  const rendered = JSON.stringify(value);
  const observation = {
    pendingRoot: f.pendingRoot, pendingAfter, error: errorRecord(error), value,
    mutations, content, identityBefore, identityAfter, comparisonBefore, comparisonAfter,
    whiteoutAfter, before, after,
  };
  record(name, "holdout", observation, {
    "operation succeeds": error === undefined && (!du || value.exitCode === 0),
    "backing snapshots unchanged": same(before, after),
    "pending garbage remains": pendingAfter,
    "no backing mutations": mutations.length === 0,
    "no content reads": content.length === 0,
    "whiteout remains hidden": whiteoutAfter === "ENOENT",
    "visible identity remains stable": same(identityBefore, identityAfter) && comparisonBefore === comparisonAfter,
    ...(listing || du ? { "pending stage is not exposed": !rendered.includes(".virtual-bash-overlay-") } : {}),
    ...(du ? { "whiteouted entry is not reported": !rendered.includes("lower-only.txt") } : {}),
  });
}

const direct = async f => ({ fs: f.overlay, path: "/" });
const readonly = async f => ({ fs: createReadOnlyFileSystem(f.overlay), path: "/" });
const mountOverOverlay = async f => ({
  fs: createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/mnt": f.overlay } }), path: "/mnt",
});
const overlayOverMountFixture = () => fixture({ lowerTransform: async (lower, extras) => {
  const mounted = createMemoryFileSystem();
  await mounted.writeFile("/mounted.txt", encoder.encode("mounted\n"));
  extras.mounted = mounted;
  return createMountFileSystem({ root: lower, mounts: { "/mnt": mounted } });
} });

await observePurity("pending direct stat is pure", direct, (fs) => fs.stat("/holdout/shared.txt"));
await observePurity("pending direct lstat is pure", direct, (fs) => fs.lstat("/holdout/shared.txt"));
for (const [label, makeView] of [["direct", direct], ["readonly wrapper", readonly], ["mount over overlay", mountOverOverlay]]) {
  await observePurity(`pending ${label} readdir is pure`, makeView, (fs, path) => fs.readdir(path), { listing: true });
  await observePurity(`pending ${label} DU traversal is pure`, makeView, (fs, path) => executeDu(fs, ["-bs", path]), { du: true });
}

for (const action of ["readdir", "du"]) {
  const f = await overlayOverMountFixture();
  const before = await snapshots(f.backings);
  const identityBefore = identity(await f.overlay.lstat("/holdout/shared.txt"));
  f.upper.reset(); f.lower.reset();
  const value = action === "readdir" ? await f.overlay.readdir("/") : await executeDu(f.overlay, ["-bs", "/"]);
  const identityAfter = identity(await f.overlay.lstat("/holdout/shared.txt"));
  const after = await snapshots(f.backings);
  const mutations = callsOf(f.observers, mutationMethods), content = callsOf(f.observers, contentMethods);
  const pendingAfter = (await f.upperBase.readdir("/")).some(entry => entry.name === f.pendingRoot);
  record(`pending overlay over mount ${action} is pure`, "holdout", {
    pendingRoot: f.pendingRoot, pendingAfter, value, mutations, content,
    identityBefore, identityAfter, before, after,
  }, {
    "operation succeeds": action === "readdir" || value.exitCode === 0,
    "backing snapshots unchanged": same(before, after),
    "pending garbage remains": pendingAfter,
    "no backing mutations": mutations.length === 0,
    "no content reads": content.length === 0,
    "visible identity remains stable": same(identityBefore, identityAfter),
    "pending stage is not exposed": !JSON.stringify(value).includes(".virtual-bash-overlay-"),
  });
}

{
  const f = await fixture();
  const before = await snapshots(f.backings);
  f.state.failReaddir = true;
  let failure;
  try { await f.overlay.readdir("/holdout"); } catch (error) { failure = error; }
  const afterFailure = await snapshots(f.backings);
  const firstMutations = callsOf(f.observers, mutationMethods);
  f.state.failReaddir = false; f.upper.reset(); f.lower.reset();
  let retry, retryError;
  try { retry = await f.overlay.readdir("/holdout"); } catch (error) { retryError = error; }
  const afterRetry = await snapshots(f.backings);
  const retryMutations = callsOf(f.observers, mutationMethods);
  const pendingAfter = (await f.upperBase.readdir("/")).some(entry => entry.name === f.pendingRoot);
  record("metadata failure and retry preserve pending state", "holdout", {
    failure: errorRecord(failure), retryError: errorRecord(retryError), retry,
    firstMutations, retryMutations, pendingAfter, before, afterFailure, afterRetry,
  }, {
    "injected metadata failure observed": failure?.code === "EIO",
    "failure leaves backing unchanged": same(before, afterFailure),
    "retry succeeds": retryError === undefined && Array.isArray(retry),
    "retry leaves backing unchanged": same(afterFailure, afterRetry),
    "pending garbage remains through retry": pendingAfter,
    "failure and retry make no mutations": firstMutations.length === 0 && retryMutations.length === 0,
  });
}

{
  const f = await fixture();
  const before = await snapshots(f.backings);
  const controller = new AbortController();
  const reason = new Error("pre-aborted-holdout"); controller.abort(reason);
  let rejected;
  try { await f.overlay.readdir("/", { signal: controller.signal }); } catch (error) { rejected = error; }
  const after = await snapshots(f.backings);
  const pendingAfter = (await f.upperBase.readdir("/")).some(entry => entry.name === f.pendingRoot);
  record("pre-aborted metadata read is pure", "holdout", {
    exactReason: rejected === reason, error: errorRecord(rejected), pendingAfter,
    mutations: callsOf(f.observers, mutationMethods), before, after,
  }, {
    "exact abort reason observed": rejected === reason,
    "backing snapshots unchanged": same(before, after),
    "pending garbage remains": pendingAfter,
    "no mutations": callsOf(f.observers, mutationMethods).length === 0,
  });
}

{
  const f = await fixture();
  const before = await snapshots(f.backings);
  const controller = new AbortController();
  f.state.midAbort = controller; f.state.abortPath = "/holdout";
  const result = await executeDu(f.overlay, ["-bs", "/holdout"], {}, controller.signal);
  const after = await snapshots(f.backings);
  const mutations = callsOf(f.observers, mutationMethods);
  const pendingAfter = (await f.upperBase.readdir("/")).some(entry => entry.name === f.pendingRoot);
  record("mid-traversal cancellation is pure", "holdout", {
    result, aborted: controller.signal.aborted, pendingAfter, mutations, before, after,
  }, {
    "abort injection was reached": controller.signal.aborted,
    "command does not report success": result.settled === "rejected" || result.exitCode !== 0,
    "backing snapshots unchanged": same(before, after),
    "pending garbage remains": pendingAfter,
    "no mutations": mutations.length === 0,
  });
}

async function observeActiveStage(action) {
  const lowerBase = createMemoryFileSystem(), upperBase = createMemoryFileSystem();
  await seedStandard(lowerBase, upperBase);
  let renameEnteredResolve, releaseRename, listingEnteredResolve, releaseListing;
  const renameEntered = new Promise(resolve => { renameEnteredResolve = resolve; });
  const renameGate = new Promise(resolve => { releaseRename = resolve; });
  const listingEntered = new Promise(resolve => { listingEnteredResolve = resolve; });
  const listingGate = new Promise(resolve => { releaseListing = resolve; });
  let pauseListing = false;
  const upper = instrument(upperBase, {
    async rename({ args, proceed }) {
      if (args[1] === "/active") { renameEnteredResolve(); await renameGate; }
      return proceed();
    },
    async readdir({ args, proceed }) {
      if (pauseListing && args[0] === "/") { listingEnteredResolve(); await listingGate; }
      return proceed();
    },
  });
  const lower = instrument(lowerBase);
  const overlay = createOverlayFileSystem({ upper: upper.fs, lower: lower.fs });
  const mutationTask = overlay.mkdir("/active");
  await renameEntered;
  const activeNames = (await upperBase.readdir("/")).map(entry => entry.name);
  pauseListing = true;
  let traversalSettled = false;
  const traversalTask = (action === "du" ? executeDu(overlay, ["-bs", "/"]) : overlay.readdir("/"))
    .then(value => { traversalSettled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  const queuedWhileActive = !traversalSettled;
  releaseRename();
  await listingEntered;
  await mutationTask;
  const mutationsAtListingEntry = callsOf([upper, lower], mutationMethods);
  const beforeListing = await snapshots({ upper: upperBase, lower: lowerBase });
  releaseListing();
  const traversal = await traversalTask;
  const afterListing = await snapshots({ upper: upperBase, lower: lowerBase });
  const allMutations = callsOf([upper, lower], mutationMethods);
  record(`active stage remains hidden and queued ${action} phase is pure`, "holdout", {
    activeNames, queuedWhileActive, traversal, mutationsAtListingEntry, allMutations,
    beforeListing, afterListing,
  }, {
    "real active stage existed": activeNames.some(name => name.startsWith(".virtual-bash-overlay-")),
    "metadata traversal queued behind active mutation": queuedWhileActive,
    "traversal succeeds": action !== "du" || traversal.exitCode === 0,
    "active stage absent from result": !JSON.stringify(traversal).includes(".virtual-bash-overlay-"),
    "metadata phase adds no mutation": allMutations.length === mutationsAtListingEntry.length,
    "metadata phase leaves backing unchanged": same(beforeListing, afterListing),
  });
}

await observeActiveStage("readdir");
await observeActiveStage("du");

{
  const f = await fixture();
  const before = await snapshots(f.backings);
  f.upper.reset(); f.lower.reset();
  await f.overlay.cleanup();
  const after = await snapshots(f.backings);
  const mutations = callsOf(f.observers, mutationMethods);
  record("explicit cleanup remains a functional positive control", "control", {
    pendingRoot: f.pendingRoot, mutations, before, after,
  }, {
    "explicit cleanup changes backing": !same(before, after),
    "explicit cleanup issues mutation": mutations.some(call => call.method === "rm"),
    "pending entry removed": !(await f.upperBase.readdir("/")).some(entry => entry.name === f.pendingRoot),
  });
}

{
  const f = await fixture({ pending: false, whiteout: false });
  const before = await snapshots(f.backings);
  f.upper.reset(); f.lower.reset();
  await f.overlay.writeFile("/holdout/shared.txt", encoder.encode("mutated\n"));
  const after = await snapshots(f.backings);
  const mutations = callsOf(f.observers, mutationMethods);
  record("ordinary overlay mutation remains a functional positive control", "control", { mutations, before, after }, {
    "backing changes": !same(before, after), "mutation counter increments": mutations.length > 0,
  });
}

{
  const f = await fixture({ pending: false, whiteout: false });
  f.upper.reset(); f.lower.reset();
  const bytes = await f.overlay.readFile("/holdout/lower-only.txt");
  const content = callsOf(f.observers, contentMethods);
  record("ordinary content read remains a functional positive control", "control", {
    bytes: Buffer.from(bytes).toString(), content,
  }, { "literal bytes returned": Buffer.from(bytes).toString() === "lower-only\n", "content counter increments": content.length > 0 });
}

{
  const f = await fixture();
  const before = await snapshots(f.backings);
  const mutant = proxyWith(f.overlay, { async readdir(path, options) {
    await f.upper.fs.rm(`/${f.pendingRoot}`, { recursive: true, force: true });
    return f.overlay.readdir(path, options);
  } });
  f.upper.reset(); f.lower.reset();
  await mutant.readdir("/");
  const after = await snapshots(f.backings);
  const detected = !same(before, after) || callsOf(f.observers, mutationMethods).length > 0;
  record("negative control kills readdir cleanup mutant", "control", { detected, before, after,
    mutations: callsOf(f.observers, mutationMethods) }, { "actual removal mutant detected": detected });
}

{
  const f = await fixture({ pending: false, whiteout: false });
  const mutant = proxyWith(f.overlay, { async readdir(path, options) {
    await f.overlay.readFile("/holdout/lower-only.txt", options);
    return f.overlay.readdir(path, options);
  } });
  f.upper.reset(); f.lower.reset();
  await executeDu(mutant, ["-bs", "/holdout"]);
  const content = callsOf(f.observers, contentMethods);
  record("negative control kills DU content-read mutant", "control", { content }, { "actual content-read mutant detected": content.length > 0 });
}

{
  const f = await fixture({ pending: false, whiteout: false });
  const before = await snapshots(f.backings);
  const mutant = proxyWith(f.overlay, { async readdir(path, options) {
    await f.overlay.writeFile("/holdout/lower-only.txt", encoder.encode("copied-up-mutant\n"), options);
    return f.overlay.readdir(path, options);
  } });
  f.upper.reset(); f.lower.reset();
  await executeDu(mutant, ["-bs", "/holdout"]);
  const after = await snapshots(f.backings), mutations = callsOf(f.observers, mutationMethods);
  const detected = !same(before, after) && mutations.length > 0;
  record("negative control kills DU copy-up mutant", "control", { detected, mutations, before, after }, { "actual copy-up mutant detected": detected });
}

{
  const fs = createMemoryFileSystem();
  await fs.mkdir("/holdout");
  await fs.writeFile("/holdout/discriminating.bin", new Uint8Array(2049));
  const args = ["--apparent-size", "-s", "/holdout"];
  const noEnv = await executeDu(fs, args, {});
  const lower = await executeDu(fs, args, { BLOCK_SIZE: "1" });
  const invalidSelected = await executeDu(fs, args, { DU_BLOCK_SIZE: "invalid-value", BLOCK_SIZE: "1" });
  const emptySelected = await executeDu(fs, args, { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1" });
  const strictInvalid = await executeDu(fs, ["--apparent-size", "-s", "-B", "invalid-value", "/holdout"], {});
  const explicitValid = await executeDu(fs, ["--apparent-size", "-s", "-B", "1", "/holdout"], { DU_BLOCK_SIZE: "invalid-value", BLOCK_SIZE: "2048" });
  const discriminating = noEnv.exitCode === 0 && lower.exitCode === 0 && noEnv.stdout !== lower.stdout;
  record("invalid selected DU_BLOCK_SIZE falls back to no-env default", "holdout", {
    noEnv, lower, invalidSelected, discriminating,
  }, {
    "fixture discriminates default from lower BLOCK_SIZE": discriminating,
    "invalid selected succeeds": invalidSelected.exitCode === 0,
    "invalid selected equals no-env default": invalidSelected.stdout === noEnv.stdout && invalidSelected.stderr === noEnv.stderr,
    "invalid selected does not fall through to lower BLOCK_SIZE": invalidSelected.stdout !== lower.stdout,
  });
  record("empty selected DU_BLOCK_SIZE falls back to no-env default", "holdout", {
    noEnv, lower, emptySelected, discriminating,
  }, {
    "fixture discriminates default from lower BLOCK_SIZE": discriminating,
    "empty selected succeeds": emptySelected.exitCode === 0,
    "empty selected equals no-env default": emptySelected.stdout === noEnv.stdout && emptySelected.stderr === noEnv.stderr,
    "empty selected does not fall through to lower BLOCK_SIZE": emptySelected.stdout !== lower.stdout,
  });
  record("explicit -B remains strict and valid explicit precedence works", "control", {
    lower, strictInvalid, explicitValid,
  }, {
    "invalid explicit -B fails": strictInvalid.exitCode !== 0 && strictInvalid.stdout === "",
    "valid explicit -B succeeds": explicitValid.exitCode === 0,
    "valid explicit -B selects literal unit": explicitValid.stdout === lower.stdout,
  });
}

const summary = {
  total: results.length,
  passed: results.filter(result => result.pass).length,
  failed: results.filter(result => !result.pass).length,
  holdouts: {
    passed: results.filter(result => result.category === "holdout" && result.pass).length,
    failed: results.filter(result => result.category === "holdout" && !result.pass).length,
  },
  controls: {
    passed: results.filter(result => result.category === "control" && result.pass).length,
    failed: results.filter(result => result.category === "control" && !result.pass).length,
  },
};
process.stdout.write(`${JSON.stringify({ extractedRoot, summary, results }, null, 2)}\n`);
process.exitCode = summary.failed === 0 ? 0 : 1;
