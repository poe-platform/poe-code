import assert from "node:assert/strict";
import { Shell, standardCommands, diffPatchCommands, FsError, type ShellResult, type ErrnoCode } from "../../../../src/index.js";
import { backends, supported, raceBackends, binary, seedBytes, fixture, snapshots, nativeBoundary, errno, type Backend, type Event, type Namespace } from "./harness.js";

type Action = "patch" | "rmdir" | "rm-d";
type Scenario = "empty" | "inject" | "lower-race" | "EACCES" | "EIO" | "abort-ENOENT" | "abort-EIO" | "preabort" | "symlink-final" | "symlink-ancestor" | "root" | "mount-root" | "rm-file" | "rm-recursive" | "rm-plain-directory" | "nonempty";
export interface Case { backend: Backend; action: Action; scenario: Scenario; seed?: number }
export interface Evidence {
  case: Case;
  classification: string;
  command?: string;
  input?: string;
  before?: Record<string, Namespace>;
  after?: Record<string, Namespace>;
  trace: Event[];
  result?: Pick<ShellResult, "exitCode" | "stdout" | "stderr">;
  thrown?: string;
  provider?: unknown;
  failure?: string;
  passed: boolean;
}

export function cases(outsideContract = false): Case[] {
  if (outsideContract) return ["patch", "rmdir", "rm-d"].map((action): Case => {
    assert.ok(action === "patch" || action === "rmdir" || action === "rm-d");
    return { backend: "overlay-static", action, scenario: "lower-race" };
  });
  const result: Case[] = [];
  for (const backend of backends) for (const action of ["patch", "rmdir", "rm-d"] as const) {
    result.push({ backend, action, scenario: "empty" }, { backend, action, scenario: "nonempty" });
    if (raceBackends.includes(backend)) for (const seed of [17, 90, 803, 1230, 6007, 65520]) result.push({ backend, action, scenario: "inject", seed });
  }
  for (const backend of ["memory", "real"] as const) {
    for (const action of ["patch", "rmdir", "rm-d"] as const) for (const scenario of ["EACCES", "EIO", "abort-ENOENT", "abort-EIO", "preabort", "symlink-final", "symlink-ancestor", "root"] as const) {
      if (scenario === "symlink-ancestor" && action !== "patch") continue;
      result.push({ backend, action, scenario });
    }
    for (const scenario of ["rm-file", "rm-recursive", "rm-plain-directory"] as const) result.push({ backend, action: "rm-d", scenario });
  }
  for (const action of ["patch", "rmdir", "rm-d"] as const) result.push({ backend: "mount-memory", action, scenario: "mount-root" });
  for (const backend of ["s3", "webdav"] as const) for (const action of ["patch", "rmdir", "rm-d"] as const) for (const scenario of ["EACCES", "EIO"] as const) result.push({ backend, action, scenario });
  return result;
}

export async function runCase(spec: Case): Promise<Evidence> {
  const current = await fixture(spec.backend);
  const evidence: Evidence = { case: spec, classification: supported.includes(spec.backend) ? "supported" : spec.backend === "readonly" ? "read-only refusal" : "explicit unsupported", trace: current.events, passed: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("bounded case exceeded 5 seconds")), 5000);
  let leaf = `${current.cwd}/branch/leaf`;
  let target = `${leaf}/file`;
  let shell: Shell | undefined;
  try {
    if (spec.action !== "patch" && !["rm-file", "rm-recursive", "rm-plain-directory"].includes(spec.scenario)) await current.writable.rm(target);
    let relative = "branch/leaf/file";
    let operand = "branch/leaf";
    if (spec.scenario === "mount-root" && spec.action === "patch") {
      await current.writable.rm(current.cwd, { recursive: true });
      current.cwd = "/";
      leaf = "/volume";
      target = "/volume/file";
      relative = "volume/file";
      await current.writable.writeFile(target, seedBytes);
      await current.writable.writeFile("/keep", binary);
    }
    if (spec.scenario === "root" && spec.action === "patch") {
      current.cwd = "/";
      relative = "work/branch/leaf/file";
      await current.writable.writeFile("/keep", binary);
    }
    const expected = await snapshots(current);
    let child: string | undefined;
    const payload = Uint8Array.from([...binary, (spec.seed ?? 0) & 255, ((spec.seed ?? 0) >>> 8) & 255]);
    if (spec.scenario === "nonempty") {
      child = `${leaf}/retained.bin`;
      await current.writable.writeFile(child, payload);
    }
    if (spec.scenario === "symlink-final") {
      assert.ok(current.writable.symlink);
      if (spec.action === "patch") {
        await current.writable.rm(target);
        await current.writable.symlink("/external/sentinel", target);
      } else {
        await current.writable.rmdir?.(leaf);
        await current.writable.symlink("/external", leaf);
      }
    }
    if (spec.scenario === "symlink-ancestor") {
      assert.ok(current.writable.symlink);
      await current.writable.mkdir("/external/selected");
      if (spec.action === "patch") await current.writable.writeFile("/external/selected/file", seedBytes);
      await current.writable.symlink("/external/selected", `${current.cwd}/alias`);
      relative = "alias/file";
      operand = "alias";
    }
    if (spec.scenario === "root") operand = "/";
    if (spec.scenario === "mount-root") operand = "/volume";
    if (spec.scenario === "rm-file") operand = "branch/leaf/file";
    const before = await snapshots(current);
    evidence.before = before;
    current.events.length = 0;
    let injected = 0;
    const inject = async () => {
      if (injected++) return;
      const seed = spec.seed ?? 17;
      let state = seed >>> 0;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      for (let tick = 0; tick < state % 4; tick++) await Promise.resolve();
      const nested = state % 2 === 0;
      const folder = nested ? `${leaf}/child-${seed}` : leaf;
      const injectionFs = current.layers.upper ?? current.layers.mounted ?? current.writable;
      const injectionPath = (path: string) => current.layers.mounted ? path.replace(/^\/volume/u, "") : path;
      if (nested) await injectionFs.mkdir(injectionPath(folder));
      child = `${folder}/binary-${seed}`;
      await injectionFs.writeFile(injectionPath(child), payload);
      current.events.push({ layer: "adversary", operation: "insert-child", path: child, detail: Buffer.from(payload).toString("hex") });
    };
    if (spec.scenario === "inject") {
      if (spec.backend === "real") nativeBoundary(current, leaf, inject);
      else current.hook = async path => { if (path.endsWith("/branch/leaf")) await inject(); };
    }
    if (spec.scenario === "lower-race") {
      let armed = false;
      current.entryHook = async path => { if (path === leaf) armed = true; };
      current.lowerListingHook = async path => {
        if (!armed || path !== leaf || injected) return;
        injected++;
        child = `${leaf}/lower-boundary.bin`;
        assert.ok(current.layers.lower);
        await current.layers.lower.writeFile(child, payload);
        current.events.push({ layer: "adversary-lower-listing-boundary", operation: "insert-child-after-list", path: child, detail: Buffer.from(payload).toString("hex") });
      };
    }
    if (["s3", "webdav"].includes(spec.backend) && (spec.scenario === "EACCES" || spec.scenario === "EIO")) {
      const fault = spec.scenario;
      current.entryHook = async () => { current.remoteFault = fault; };
    } else if (["EACCES", "EIO", "abort-ENOENT", "abort-EIO"].includes(spec.scenario)) current.hook = async (path, options) => {
      assert.ok(options?.signal, "mandatory command signal reaches empty-only primitive");
      await inject();
      const code: ErrnoCode = spec.scenario === "EACCES" ? "EACCES" : spec.scenario === "abort-ENOENT" ? "ENOENT" : "EIO";
      const error = new FsError(code, { syscall: "rmdir", path });
      if (spec.scenario.startsWith("abort-")) controller.abort(error);
      throw error;
    };
    if (spec.scenario === "preabort") controller.abort(new FsError("ENOENT", { path: leaf }));
    const forced = spec.scenario.startsWith("abort-") || spec.backend === "missing" || spec.seed !== undefined && spec.seed % 2 === 0;
    let command = spec.action === "patch" ? "patch -p0" : spec.action === "rmdir" ? `rmdir '${operand}'` : `rm ${forced ? "-df" : "-d"} '${operand}'`;
    if (spec.scenario === "rm-recursive") command = `rm -r '${operand}'`;
    if (spec.scenario === "rm-plain-directory") command = `rm '${operand}'`;
    if (spec.scenario === "rm-file") command = `rm '${operand}'`;
    const input = `--- ${relative}\n+++ /dev/null\n@@ -1 +0,0 @@\n-remove me\n`;
    evidence.command = command;
    if (spec.action === "patch") evidence.input = input;
    shell = new Shell({ fs: current.fs, cwd: current.cwd, limits: { maxCommands: 4, maxOutputBytes: 65536 } }).use(standardCommands()).use(diffPatchCommands());
    let thrown: unknown;
    try {
      const response = await shell.exec(command, { ...(spec.action === "patch" ? { stdin: input } : {}), signal: controller.signal });
      evidence.result = { exitCode: response.exitCode, stdout: response.stdout, stderr: response.stderr };
    } catch (error) { thrown = error; evidence.thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
    current.restoreNative?.();
    current.restoreNative = undefined;
    current.remoteFault = undefined;
    evidence.trace = [...current.events];
    evidence.after = await snapshots(current);
    evidence.provider = current.provider?.();
    const visibleBefore = before.visible!;
    const visibleAfter = evidence.after.visible!;
    assert.deepEqual(visibleAfter["/external/sentinel"], visibleBefore["/external/sentinel"]);
    const keepPath = `${current.cwd === "/" ? "" : current.cwd}/keep`;
    assert.deepEqual(visibleAfter[keepPath], visibleBefore[keepPath]);
    assert.ok(visibleAfter["/"], "root survives");
    assert.ok(visibleAfter[current.cwd], "working directory survives");
    const removals = evidence.trace.filter(event => event.operation === "rm");
    const pruningStart = evidence.trace.findIndex(event => event.layer === "consumer" && event.operation === "rmdir");
    if (spec.scenario !== "rm-recursive") {
      assert.ok(removals.filter(event => event.layer === "consumer").every(event => !event.recursive), "no consumer recursive rm fallback");
      const recursiveBackend = removals.filter(event => event.recursive);
      for (const event of recursiveBackend) {
        assert.ok(spec.backend.startsWith("overlay") && /^\/\.virtual-bash-overlay-[0-9a-f-]+$/u.test(event.path), "only overlay pre-pruning private staging cleanup may be recursive");
        if (pruningStart >= 0) assert.ok(evidence.trace.indexOf(event) < pruningStart, "no recursive deletion after pruning begins");
      }
    }
    if (spec.action !== "patch" && !["rm-file", "rm-recursive", "symlink-final"].includes(spec.scenario)) assert.equal(removals.length, 0, "directory-only operation never invokes rm");
    for (const event of evidence.trace.filter(event => event.operation === "rmdir" && event.layer !== "native-empty-only-boundary")) assert.equal(event.signal, true);
    if (child) assert.equal(visibleAfter[child]?.hex, Buffer.from(payload).toString("hex"), "binary child survives even error or cancellation");
    const aborted = spec.scenario.startsWith("abort-") || spec.scenario === "preabort";
    if (aborted) {
      assert.ok(controller.signal.aborted);
      assert.ok(thrown !== undefined || evidence.result?.exitCode !== 0, "cancellation must not be swallowed as ENOENT success");
      if (spec.scenario === "preabort") assert.deepEqual(evidence.after, before);
    } else {
      assert.equal(thrown, undefined);
      assert.ok(evidence.result);
      const guard = ["symlink-final", "symlink-ancestor"].includes(spec.scenario);
      const success = spec.scenario === "rm-recursive" || spec.scenario === "rm-file"
        || (spec.scenario === "symlink-final" && spec.action === "rm-d")
        || (spec.scenario === "root" && spec.action === "patch")
        || (!guard && !["EACCES", "EIO", "root", "mount-root", "rm-plain-directory"].includes(spec.scenario)
          && (spec.action === "patch" && ["inject", "nonempty"].includes(spec.scenario) && spec.backend !== "readonly"
            || supported.includes(spec.backend) && spec.scenario === "empty"));
      assert.equal(evidence.result.exitCode === 0, success, evidence.result.stderr);
      if (spec.scenario === "empty" && !supported.includes(spec.backend)) {
        const code = spec.backend === "readonly" ? "EROFS" : "ENOTSUP";
        const meaning = code === "EROFS" ? /read-only/i : spec.backend === "s3" ? /cannot atomically require an empty directory prefix/i : spec.backend === "webdav" ? /no safe portable WebDAV equivalent/i : /not supported/i;
        assert.match(evidence.result.stderr, meaning);
        const boundaryErrors = evidence.trace.filter(event => event.operation === "rmdir" && event.code);
        if (spec.backend !== "missing" && spec.backend !== "readonly") assert.ok(boundaryErrors.some(event => event.code === code));
        evidence.classification = spec.action === "patch" && spec.backend !== "readonly" ? "unsupported pruning; target deletion already committed" : evidence.classification;
      }
      if (spec.scenario === "EACCES" || spec.scenario === "EIO") {
        assert.ok(evidence.trace.some(event => event.operation === "rmdir" && event.code === spec.scenario));
        assert.match(evidence.result.stderr, spec.scenario === "EACCES" ? /permission denied/i : /input\/output error/i);
      }
      if (spec.scenario === "inject") {
        assert.equal(injected, 1);
        assert.ok(evidence.trace.some(event => event.operation === "rmdir" && event.code === "ENOTEMPTY"));
      }
    }
    const expectedVisible = structuredClone(visibleBefore);
    const removesTarget = spec.action === "patch" && !["preabort", "symlink-final", "symlink-ancestor"].includes(spec.scenario) && spec.backend !== "readonly";
    if (removesTarget || spec.scenario === "rm-file") delete expectedVisible[target];
    if (spec.scenario === "rm-recursive") for (const path of Object.keys(expectedVisible)) if (path === leaf || path.startsWith(`${leaf}/`)) delete expectedVisible[path];
    if (spec.scenario === "symlink-final" && spec.action === "rm-d") delete expectedVisible[leaf];
    if (supported.includes(spec.backend) && (spec.scenario === "empty" || spec.scenario === "root" && spec.action === "patch")) {
      delete expectedVisible[leaf];
      if (spec.action === "patch") delete expectedVisible[leaf.slice(0, leaf.lastIndexOf("/"))];
    }
    if (child && spec.scenario !== "nonempty") {
      const parent = child.slice(0, child.lastIndexOf("/"));
      if (parent !== leaf) expectedVisible[parent] = { type: "directory" };
      expectedVisible[child] = { type: "file", hex: Buffer.from(payload).toString("hex") };
    }
    assert.deepEqual(visibleAfter, expectedVisible, "complete visible namespace equals exact allowed effects");
    if (spec.backend.startsWith("overlay")) {
      const expectedLower = structuredClone(expected.lower);
      if (spec.scenario === "lower-race" && child && expectedLower) expectedLower[child] = { type: "file", hex: Buffer.from(payload).toString("hex") };
      assert.deepEqual(evidence.after.lower, expectedLower, "lower namespace stays untouched except deliberate adversary insertion");
      if (spec.scenario === "lower-race") assert.equal(injected, 1);
    }
    if (spec.backend === "mount-memory") assert.deepEqual(evidence.after.root, before.root, "unmounted external namespace survives");
    if (spec.scenario === "root") assert.ok(evidence.trace.every(event => !(event.operation === "rmdir" && event.path === "/")), "consumer never tries to remove root");
    if (spec.scenario === "mount-root") assert.ok(evidence.trace.some(event => event.path === "/volume" && event.code === "EBUSY"), "mounted root must refuse empty-only removal");
    if (spec.backend === "real") {
      assert.deepEqual(evidence.after.host?.["/outside"], before.host?.["/outside"]);
      assert.deepEqual(evidence.after.host?.["/outside/host-sentinel"], before.host?.["/outside/host-sentinel"]);
    }
    if (spec.backend === "s3") assert.deepEqual(evidence.after.provider?.["/unmounted/sentinel"], before.provider?.["/unmounted/sentinel"]);
    if (spec.backend === "s3" || spec.backend === "webdav") {
      const deletes = evidence.trace.filter(event => event.layer.endsWith("-transport") && ["deleteObject", "DELETE"].includes(event.operation));
      assert.equal(deletes.length, spec.action === "patch" ? 1 : 0, "only the selected patch file may be deleted remotely");
      for (const event of deletes) assert.equal(event.path, spec.backend === "s3" ? `owned${target}` : `/dav${target}`);
      if (pruningStart >= 0) assert.ok(deletes.every(event => evidence.trace.indexOf(event) < pruningStart), "no transport deletion during empty-only refusal");
    }
    evidence.passed = true;
  } catch (error) {
    evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    clearTimeout(timeout);
    await shell?.dispose();
    await current.close();
  }
  return evidence;
}

export async function capabilityCases(): Promise<Evidence[]> {
  const results: Evidence[] = [];
  for (const backend of backends) {
    const current = await fixture(backend);
    const evidence: Evidence = { case: { backend, action: "rmdir", scenario: "empty" }, classification: "direct capability probe, not consumer success", trace: current.events, passed: false };
    try {
      const path = `${current.cwd}/branch/leaf`;
      await current.writable.rm(`${path}/file`);
      evidence.before = await snapshots(current);
      current.events.length = 0;
      let error: unknown;
      try {
        if (current.fs.rmdir) await current.fs.rmdir(path, { signal: new AbortController().signal });
      } catch (caught) { error = caught; }
      evidence.trace = [...current.events];
      evidence.after = await snapshots(current);
      evidence.provider = current.provider?.();
      if (supported.includes(backend)) {
        assert.equal(error, undefined);
        const expected = structuredClone(evidence.before.visible!);
        delete expected[path];
        assert.deepEqual(evidence.after.visible, expected);
      } else {
        if (backend === "missing") {
          assert.equal(current.fs.rmdir, undefined);
          assert.equal(error, undefined);
          evidence.thrown = "optional method absent; no filesystem rmdir call possible";
        } else {
          assert.ok(error instanceof FsError);
          assert.equal(errno(error), backend === "readonly" ? "EROFS" : "ENOTSUP");
          evidence.thrown = error.message;
        }
        assert.deepEqual(evidence.after, evidence.before);
        assert.ok(evidence.trace.every(event => event.operation !== "rm"));
      }
      evidence.passed = true;
    } catch (error) { evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error); }
    finally { await current.close(); }
    results.push(evidence);
  }
  return results;
}
