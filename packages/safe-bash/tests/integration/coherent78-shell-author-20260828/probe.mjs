import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { expectedNames } from "./names.mjs";

const root = fs.realpathSync(process.env.PRODUCT_ROOT);
assert.equal(import.meta.resolve("virtual-bash"), pathToFileURL(path.join(root, "dist/index.js")).href);
let forbiddenNetwork = 0;
const denyNetwork = () => { forbiddenNetwork++; throw new Error("Unconfigured host network is forbidden in this fixture"); };
http.request = denyNetwork; https.request = denyNetwork; globalThis.fetch = denyNetwork;
syncBuiltinESMExports();
const api = await import("virtual-bash");
const timeoutApi = await import("virtual-bash/commands/timeout");
const frozen = JSON.parse(fs.readFileSync(new URL("./CASES.json", import.meta.url), "utf8"));
const amendment = JSON.parse(fs.readFileSync(new URL("./CASES-v2-overlay.json", import.meta.url), "utf8"));
const revised = frozen.cases.map(row => row.id === "C15" ? { ...row, unicodeValues: amendment.C15.unicodeValues } : row);
const originalC15 = frozen.cases.find(row => row.id === "C15");
const refusal = { ...originalC15, ...amendment.refusal };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let resources = [];
let detail = {};

function clock() {
  const scheduler = {
    time: 0, calls: [], handles: new Map(), sequence: 0,
    now() { assert.equal(this, scheduler); this.calls.push("now"); return this.time; },
    setTimeout(callback, milliseconds) { assert.equal(this, scheduler); const handle = ++this.sequence; this.calls.push(["arm", milliseconds]); this.handles.set(handle, callback); return handle; },
    clearTimeout(handle) { assert.equal(this, scheduler); this.calls.push(["clear", handle]); this.handles.delete(handle); },
    fire(time) { this.time = time; const callbacks = [...this.handles.values()]; this.handles.clear(); for (const callback of callbacks) callback(); },
  };
  return scheduler;
}

async function fixture(options = {}) {
  const filesystem = options.fs ?? new api.MemoryFileSystem();
  if (!options.fs) {
    for (const directory of frozen.fixture.directories) await filesystem.mkdir(directory, { recursive: true });
    for (const [name, value] of Object.entries(frozen.fixture.files)) await filesystem.writeFile(name, encoder.encode(value));
  }
  const shell = new api.Shell({ fs: filesystem, cwd: "/w", env: { HOME: "/home", PATH: "" }, ...(options.limits ? { limits: options.limits } : {}) }).use(api.agentCommands(options.plugin));
  resources.push(shell);
  return { shell, fs: filesystem };
}

function match(row, result) {
  detail.result = { stdout: result.stdout, stderr: result.stderr, status: result.exitCode, stdoutBytes: [...result.stdoutBytes] };
  assert.equal(result.exitCode, row.status);
  if (row.stdout !== undefined) assert.equal(result.stdout, row.stdout + (process.env.CONTROL === "assertion" && row.id === "C02" ? "!" : ""));
  if (row.stdoutBytes) assert.deepEqual([...result.stdoutBytes], row.stdoutBytes);
  if (row.stderrContains) assert.ok(result.stderr.includes(row.stderrContains));
  else if (row.id !== "C17") assert.equal(result.stderr, row.stderr ?? "");
}

function network(mode) {
  const started = deferred();
  const events = { authorized: 0, requests: 0, acquires: 0, next: 0, delivered: 0, returned: 0, finalized: 0, disposed: 0, pending: 0, listeners: 0, order: [] };
  let requestSignal;
  let pending;
  let finalized = false;
  const finish = () => { if (!finalized) { finalized = true; events.finalized++; } };
  const bytes = encoder.encode(JSON.stringify({ text: "😀é" }));
  const chunks = [bytes.subarray(0, 10), bytes.subarray(10)];
  const options = {
    authorize(request) { assert.equal(new URL(request.url).origin, "https://fixture.invalid"); events.authorized++; return true; },
    async transport(request) {
      assert.equal(new URL(request.url).origin, "https://fixture.invalid");
      requestSignal = request.signal; events.requests++; events.order.push("request");
      let position = 0;
      return {
        status: 200, statusText: "OK", headers: [["X-Fixture", "yes"]],
        body: { [Symbol.asyncIterator]() {
          events.acquires++; events.order.push("acquire");
          return {
            async next() {
              events.next++;
              if (mode === "finite") {
                if (position === chunks.length) { finish(); return { done: true }; }
                events.delivered++; return { done: false, value: chunks[position++] };
              }
              if (mode === "head" && position++ === 0) { events.delivered++; return { done: false, value: encoder.encode("xyz") }; }
              started.resolve();
              request.signal.throwIfAborted();
              events.pending++; events.listeners++;
              const gate = deferred();
              const stop = reason => {
                if (pending?.gate !== gate) return;
                request.signal.removeEventListener("abort", abort);
                events.pending--; events.listeners--; pending = undefined;
                gate.reject(reason);
              };
              const abort = () => stop(request.signal.reason);
              pending = { gate, stop };
              request.signal.addEventListener("abort", abort, { once: true });
              return gate.promise;
            },
            async return() { events.returned++; events.order.push("return"); pending?.stop(new Error("fixture iterator returned")); finish(); return { done: true }; },
          };
        } },
        async dispose() { events.disposed++; events.order.push("dispose"); pending?.stop(new Error("fixture response disposed")); finish(); },
      };
    },
  };
  return { events, options, started, signal: () => requestSignal };
}

function webdav() {
  const calls = [];
  const entries = new Map([["/", "directory"], ["/w", "directory"], ["/search", "directory"], ["/search/project", "directory"], ["/search/project/.hidden", "file"], ["/search/project/visible", "file"]]);
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://dav.invalid");
    assert.ok(parsed.pathname.startsWith("/dav/"));
    init.signal?.throwIfAborted();
    const name = decodeURIComponent(parsed.pathname.slice(4)).replace(/\/$/, "") || "/";
    const depth = new Headers(init.headers).get("depth");
    calls.push({ method: init.method, depth, name });
    assert.equal(init.method, "PROPFIND");
    assert.ok(depth === "0" || depth === "1");
    if (name === "/denied") return new Response(null, { status: 403 });
    if (!entries.has(name)) return new Response(null, { status: 404 });
    const selected = [name];
    if (depth === "1") for (const target of entries.keys()) if (target !== name && path.posix.dirname(target) === name) selected.push(target);
    const response = selected.map(target => `<d:response><d:href>/dav${target === "/" ? "/" : target}</d:href><d:propstat><d:prop><d:resourcetype>${entries.get(target) === "directory" ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("");
    return new Response(`<d:multistatus xmlns:d="DAV:">${response}</d:multistatus>`, { status: 207 });
  };
  return { fs: new api.WebDavFileSystem({ baseUrl: "https://dav.invalid/dav/", fetch }), calls };
}

async function execute(row) {
  if (row.id === "C01") {
    const definitions = api.createAgentCommands();
    assert.deepEqual(definitions.map(command => command.name).sort(), expectedNames);
    assert.equal(definitions.length, 78);
    for (const name of ["curl", "js", "safejs", "pushd", "dirs", "popd", "shopt", "let", "getopts"]) assert.ok(!definitions.some(command => command.name === name));
    for (const name of ["createTimeoutCommand", "createTimeoutCommands", "timeoutCommands"]) assert.equal(api[name], timeoutApi[name]);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    for (const name of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.deepEqual(Object.keys(metadata[name] ?? {}), []);
  }
  if (["C07", "C08"].includes(row.id)) {
    const scheduler = clock();
    const limit = row.id === "C07" ? "maxCommands" : "maxOutputBytes";
    const { shell } = await fixture({ limits: { [limit]: row.id === "C07" ? 1 : 2 }, plugin: { timeout: { scheduler } } });
    await assert.rejects(shell.exec(row.script), error => error instanceof api.ShellLimitError && error.limit === limit);
    assert.deepEqual(scheduler.calls, []); detail.limit = limit; return;
  }
  if (row.id === "C09") {
    detail.reasons = [];
    for (const reason of [false, 0, new api.FsError("ENOENT")]) {
      const { shell, fs: filesystem } = await fixture();
      const controller = new AbortController();
      filesystem.access = async () => { controller.abort(reason); throw new api.FsError("EACCES"); };
      await assert.rejects(shell.exec(row.script, { signal: controller.signal }), error => Object.is(error, reason));
      detail.reasons.push({ exactIdentity: true, type: typeof reason });
    }
    return;
  }
  if (row.id === "C16") {
    const dav = webdav(), wrapped = new api.ReadOnlyFileSystem(dav.fs);
    const { shell } = await fixture({ fs: wrapped });
    match(row, await shell.exec(row.script));
    assert.equal(dav.fs.capabilities.permissions, false);
    for (const [target, mode, code] of [["/denied", 1, "EACCES"], ["/w/missing", 1, "ENOENT"], ["/search/project/visible", 1, "ENOTSUP"]]) await assert.rejects(dav.fs.access(target, mode), error => error instanceof api.FsError && error.code === code);
    const before = dav.calls.length;
    await assert.rejects(wrapped.access("/w", 2), error => error instanceof api.FsError && error.code === "EROFS");
    assert.equal(dav.calls.length, before); detail.requests = dav.calls; return;
  }
  const scheduler = clock();
  const { shell, fs: filesystem } = await fixture({ plugin: { timeout: { scheduler } } });
  if (row.id === "C04") shell.commands.register({ name: "relay", async execute(context) {
    for (const [command, args, options] of [["pushd", ["-n", "/child"]], ["shopt", ["-u", "dotglob"]], ["shopt", ["-q", "dotglob"]], ["getopts", ["ab", "child", "-ab"]], ["let", ["value=99"]], ["dirs", ["-l", "-p"], { cwd: "/search/project", env: {}, replaceEnv: true }]]) assert.equal((await context.invoke(command, args, options)).exitCode, 0);
    return { exitCode: 0 };
  } });
  if (row.id === "C06") shell.use(async (context, next) => { if (context.command === "f") { await Promise.resolve(); context.cwd = "/borrowed"; } return next(); });
  if (row.id === "C10") {
    const parent = new AbortController(), local = new AbortController(), started = deferred(), reason = { local: "compound" };
    let cleaned = 0;
    shell.commands.register({ name: "gate-child", async execute(context) {
      context.registerCleanup(() => { cleaned++; });
      started.resolve();
      await new Promise((resolve, reject) => { if (context.signal.aborted) reject(context.signal.reason); else context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true }); });
      return { exitCode: 0 };
    } });
    shell.commands.register({ name: "relay", async execute(context) {
      const child = context.invoke("gate-child", [], { signal: local.signal });
      const rejection = assert.rejects(child, error => error === reason);
      await started.promise; local.abort(reason); await rejection;
      assert.equal(cleaned, 1); assert.equal(context.signal.aborted, false);
      assert.equal((await context.invoke("dirs", ["-c"])).exitCode, 0);
      return { exitCode: 0 };
    } });
    match(row, await shell.exec(row.script, { signal: parent.signal }));
    assert.equal(parent.signal.aborted, false); detail.cleaned = cleaned; return;
  }
  if (row.id === "C11") {
    const result = await shell.exec(row.script, { stdin: Uint8Array.from(row.stdinBytes) });
    match(row, result); assert.deepEqual([...await filesystem.readFile("/copy")], row.stdinBytes);
    assert.deepEqual(scheduler.calls, []); return;
  }
  if (["C12", "C13", "C14"].includes(row.id)) {
    const net = network(row.id === "C12" ? "finite" : row.id === "C13" ? "blocked" : "head");
    shell.use(api.networkCommands(net.options));
    const caller = new AbortController();
    const outcome = shell.exec(row.script, { signal: caller.signal });
    if (row.id === "C13") {
      const admitted = await Promise.race([net.started.promise.then(() => true), outcome.then(() => false, () => false)]);
      assert.equal(admitted, true, "Timeout must acquire a pending body before manual delivery");
      scheduler.fire(1);
    }
    const result = await outcome; net.events.order.push("settled");
    detail.network = net.events; detail.requestSignalAborted = net.signal().aborted;
    detail.schedulerCalls = scheduler.calls;
    match(row, result);
    assert.equal(caller.signal.aborted, false);
    assert.equal(net.events.authorized, 1); assert.equal(net.events.requests, 1);
    assert.equal(net.events.acquires, 1); assert.equal(net.events.finalized, 1); assert.equal(net.events.disposed, 1);
    assert.equal(net.events.pending, 0); assert.equal(net.events.listeners, 0);
    assert.ok(net.events.order.indexOf("dispose") < net.events.order.indexOf("settled"));
    if (row.id !== "C12") assert.equal(net.events.returned, 1);
    if (row.id === "C13") assert.equal(net.signal().aborted, true);
    if (row.id === "C14") { assert.equal(net.events.delivered, 1); assert.ok(net.events.next === 1 || net.events.next === 2); }
    if (row.id !== "C13") {
      assert.ok(decoder.decode(await filesystem.readFile("/headers")).includes("X-Fixture: yes"));
      assert.deepEqual(scheduler.calls, []);
    }
    assert.equal(scheduler.handles.size, 0); detail.network = net.events; detail.schedulerCalls = scheduler.calls; return;
  }
  if (row.id === "C15" || row.id === "R15") await filesystem.writeFile("/unicode.json", encoder.encode(JSON.stringify(row.unicodeValues)));
  if (row.id === "C17") shell.use((context, next) => { if (context.command === "pushd") Object.assign(context, { stdout: { async write() { throw Object.assign(new Error("fixture closed"), { code: "EPIPE" }); } } }); return next(); });
  if (row.id === "C18") {
    const setup = await shell.exec("pushd /search/project >/sink; shopt -s dotglob; let value=3; set -- -ab; getopts ab first");
    assert.equal(setup.exitCode, 0); assert.equal(setup.stderr, "");
    assert.ok((await filesystem.readFile("/sink")).length > 0);
  }
  match(row, await shell.exec(row.script));
}

if (process.env.CONTROL === "source-fallback") await import(pathToFileURL(process.env.FALLBACK_PATH).href);
const ids = process.env.CASE_IDS?.split(",");
const rows = [...revised, refusal].filter(row => !ids || ids.includes(row.id));
assert.equal(rows.length, ids?.length ?? 19);
const observations = [];
for (const row of rows) {
  resources = []; detail = {};
  const observation = { id: row.id, pass: false, detail, created: 0, disposed: 0 };
  try { await execute(row); assert.equal(forbiddenNetwork, 0); observation.pass = true; }
  catch (error) { observation.error = { name: error?.name, code: error?.code, message: error?.message ?? String(error), stack: error?.stack }; }
  finally {
    observation.created = resources.length;
    for (const shell of resources) {
      try { await shell.dispose(); observation.disposed++; }
      catch (error) { observation.pass = false; observation.cleanupError = String(error); }
    }
  }
  observations.push(observation); console.log(JSON.stringify(observation));
}
const summary = { layout: process.env.LAYOUT, profile: "root-approved-v2", cases: observations.length, positives: observations.filter(row => row.id !== "R15").length, positivePass: observations.filter(row => row.id !== "R15" && row.pass).length, refusalControls: observations.filter(row => row.id === "R15").length, refusalPass: observations.filter(row => row.id === "R15" && row.pass).length, pass: observations.filter(row => row.pass).length, failed: observations.filter(row => !row.pass).map(row => row.id), created: observations.reduce((sum, row) => sum + row.created, 0), disposed: observations.reduce((sum, row) => sum + row.disposed, 0), forbiddenNetwork, nativeRuns: 0, privateSafeJsRuns: 0 };
console.log(JSON.stringify({ summary }));
if (summary.pass !== summary.cases || summary.created !== summary.disposed) process.exitCode = 1;
