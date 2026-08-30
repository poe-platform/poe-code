import assert from "node:assert/strict";
import { describeCase, expand, inputFor, programFor, sourceKeys } from "./adapters.mjs";
import { barrier, boundedSink } from "./lifecycle.mjs";

const encoder = new TextEncoder();
const text = (chunks) => new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
const fullText = (full) => full.join("\n") + "\n";
const limits = { maxCommands: 100000, maxOutputBytes: 64 * 1024 * 1024, maxSourceBytes: 2 * 1024 * 1024, maxExpansionBytes: 2 * 1024 * 1024 };

async function namespace(fs, signal) {
  const entries = [];
  async function visit(path) {
    assert(entries.length < 128, "fixture namespace cap");
    const stat = await fs.stat(path, { signal });
    entries.push([path, stat.type, stat.mode, ...(stat.type === "file" ? [Buffer.from(await fs.readFile(path, { signal, maxBytes: 1024 * 1024 })).toString("base64")] : [])]);
    if (stat.type === "directory") for (const entry of (await fs.readdir(path, { signal })).sort((left, right) => left.name.localeCompare(right.name))) await visit(path === "/" ? "/" + entry.name : path + "/" + entry.name);
  }
  await visit("/");
  return entries;
}
async function fixture(api, row, input) {
  const fs = api.createMemoryFileSystem();
  for (const path of ["/c", "/a", "/b", "/d", "/old", "/c/+1", "/c/-dash", "/c/a", "/c/b", "/search/leaf", input.full[0]]) await fs.mkdir(path, { recursive: true });
  if (row.fixtureFile) {
    await fs.writeFile(row.fixtureFile.path, encoder.encode(row.fixtureFile.text), { mode: row.fixtureFile.executable ? 0o755 : 0o644 });
    if (row.fixtureFile.executable) { assert(fs.chmod); await fs.chmod(row.fixtureFile.path, 0o755); }
  }
  return fs;
}
function shellFor(api, fs, input) {
  return new api.Shell({ fs, cwd: input.full[0], env: input.env, limits }).use(api.agentCommands());
}
export async function runPublicCase(api, row) {
  const mapping = describeCase(row);
  assert.equal(mapping.status, "adapter-prepared-unexecuted", mapping.gap);
  if (mapping.route === "fresh-execs") return await freshExecs(api, row);
  if (mapping.route === "direct-boundary") return await directBoundary(api, row);
  const input = programFor(row);
  const fs = await fixture(api, row, input);
  let phase = "setup";
  const calls = [];
  const snapshots = {};
  const stdout = {};
  const stderr = {};
  const host = { seedFailures: [], childResults: [], childEnvs: [] };
  const watched = new Proxy(fs, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args) => {
      if (phase === "subject") {
        assert(calls.length < 16384, "fixture provider-call cap");
        calls.push({ method: String(key), path: args[0], mode: args[1] });
        if (row.id === "F11" && key === "stat" && args[0] === "/a") throw new api.FsError("EPERM", { syscall: "stat", path: "/a" });
        if (row.id === "F12" && key === "access" && args[0] === "/a") throw new api.FsError("EACCES", { syscall: "access", path: "/a" });
      }
      return Reflect.apply(value, target, args);
    };
  } });
  const shell = shellFor(api, watched, input);
  const sink = (channels) => ({ async write(chunk) {
    const channel = channels[phase] ??= boundedSink({
      ...(channels === stdout && phase === "subject" && ["F08", "F09", "F10", "C08"].includes(row.id) ? { failAt: row.id === "C08" ? 2 : 1, failure: new api.FsError("EPIPE", { syscall: "write" }) } : {}),
      ...(channels === stdout && phase === "subject" && row.id === "C07" ? { hold: async () => { await new Promise((resolve) => setImmediate(resolve)); } } : {})
    });
    await channel.write(chunk);
  } });
  shell.register({ name: "__ds_phase", async execute(context) {
    phase = context.args[0];
    if (["before", "after"].includes(phase)) snapshots[phase] = { cwd: context.cwd, env: { ...context.env }, namespace: await namespace(fs, context.signal) };
    return { exitCode: 0 };
  } });
  shell.register({ name: "__ds_seed", execute(context) { const status = Number(context.args[0]); if (status !== 0) host.seedFailures.push(status); return { exitCode: status === 0 ? 0 : 97 }; } });
  shell.register({ name: "__ds_status", execute(context) { host.status = Number(context.args[0]); return { exitCode: 0 }; } });
  shell.register({ name: "__ds_probe_status", execute(context) { host.probeStatus = Number(context.args[0]); return { exitCode: 0 }; } });
  shell.register({ name: "__ds_child", async execute(context) {
    assert(context.invoke, "actual Shell invoke required");
    const run = async (command, args, options = {}) => {
      const childSink = boundedSink();
      const result = await context.invoke(command, args, { ...options, stdout: childSink, stderr: context.stderr });
      host.childResults.push({ ...result, stdout: text(childSink.chunks) });
      return result;
    };
    if (row.id === "S10") { await run("dirs", ["-l", "-p"], { cwd: "/b" }); await run("dirs", ["-c"]); return await run("dirs", ["-l", "-p"]); }
    if (row.id === "S11") return await run("dirs", ["-l", "-p"], { cwd: "/b", replaceEnv: true, env: { PWD: "/spoof", DIRSTACK: "/d" } });
    if (row.id === "L06") return await run("pushd", input.argv.slice(1));
    if (row.id === "A03") return await run("pushd", ["-n", "$(not-executed)"]);
    return await run("pushd", ["/a"]);
  } });
  shell.use(async (context, next) => {
    if (phase === "subject" && row.id === "S11" && context.command === "dirs") host.childEnvs.push({ ...context.env });
    if (phase === "subject" && row.id.startsWith("M") && context.command === (row.id === "M01" ? "pushd" : row.id === "M02" ? "dirs" : "f")) context.cwd = "/b";
    return await next();
  });
  try {
    const result = await shell.exec(input.source, { stdout: sink(stdout), stderr: sink(stderr) });
    assert.deepEqual(host.seedFailures, [], "public seed/probe setup failed; not a product-row pass");
    assert.equal(result.exitCode, 0, "harness epilogue did not complete");
    assert.equal(host.probeStatus, 0, "same-exec public dirs probe failed");
    const observation = { status: host.status, stdout: text(stdout.subject?.chunks ?? []), stderr: text(stderr.subject?.chunks ?? []), probe: text(stdout.probe?.chunks ?? []), readonlyBefore: text(stdout.readonlyBefore?.chunks ?? []), readonlyAfter: text(stdout.readonlyAfter?.chunks ?? []), snapshots, calls, host, chunks: stdout.subject?.chunks ?? [], writes: stdout.subject?.writes ?? 0, maxPending: stdout.subject?.maximumInFlight ?? 0 };
    assertObservation(row, input, observation);
    return { id: row.id, status: "public-assertions-pass", sourceOnlyUnmeasured: mapping.sourceOnly, subjectStatus: observation.status, stdoutBytes: encoder.encode(observation.stdout).length, callCount: calls.length };
  } finally { await shell.dispose(); }
}
export function assertObservation(row, input, observed) {
  const expected = row.expect;
  assert.equal(observed.status, expected.status ?? 0);
  for (const [key, value] of Object.entries(expected)) {
    if (sourceKeys[key] || key === "qualification" || key === "status") continue;
    if (key === "stdout") assert.equal(observed.stdout, value);
    else if (key === "stdoutRecipe") assert.equal(observed.stdout, value.map(expand).join(""));
    else if (key === "full" || key === "parentFull") assert.equal(observed.probe, fullText(value));
    else if (["PWD", "OLDPWD"].includes(key)) assert.equal(observed.snapshots.after.env[key], value);
    else if (key === "calls") assert.equal(observed.calls.length, value);
    else if (key === "accessCalls") assert.equal(observed.calls.filter((entry) => entry.method === "access").length, value);
    else if (key === "fallbackCalls") assert.equal(observed.calls.filter((entry) => entry.path !== "/a").length, value);
    else if (key === "realCd") assert.deepEqual(observed.calls.filter((entry) => ["stat", "access"].includes(entry.method)).map((entry) => entry.method), ["stat", "access"]);
    else if (key === "callOrder") assert.deepEqual(observed.calls.map((entry) => `${entry.method} ${entry.path}${entry.method === "access" ? " X_OK" : ""}`), value);
    else if (key === "unchanged") { assert.equal(observed.probe, fullText(input.full)); assert.deepEqual(observed.snapshots.after, observed.snapshots.before); assert.equal(observed.readonlyAfter, observed.readonlyBefore); }
    else if (key === "envUnchanged") assert.deepEqual(observed.snapshots.after.env, observed.snapshots.before.env);
    else if (key === "readonlyRetained") assert.equal(observed.readonlyAfter, observed.readonlyBefore);
    else if (key === "subjectFull") assert.equal(observed.stdout, value.join(" ") + "\n");
    else if (key === "subjectStdout") assert.equal(observed.stdout, value);
    else if (key === "childStdout") assert.equal(observed.host.childResults[0]?.stdout, value);
    else if (key === "noSiblingWriteback") assert.equal(observed.host.childResults[2]?.stdout, fullText(input.full));
    else if (key === "entryEnvExact") assert.deepEqual(observed.host.childEnvs, [{ PWD: "/spoof", DIRSTACK: "/d" }]);
    else if (key === "diagnostic") { assert.match(observed.stderr, /dirs/); assert(encoder.encode(observed.stderr).length < 66048); }
    else if (key === "diagnosticPayload") assert(observed.stderr.includes(value), "exact private diagnostic payload missing; full envelope remains source proof");
    else if (key === "diagnosticPreservesCodeMeaningAndPath") { assert(observed.stderr.includes("/a")); assert(observed.stderr.includes(row.id === "F11" ? "operation not permitted" : "permission denied")); }
    else if (key === "allChunksAtMost") assert(observed.chunks.every((chunk) => chunk.length <= value));
    else if (key === "noSplitSurrogatePairs") for (const chunk of observed.chunks) new TextDecoder("utf8", { fatal: true }).decode(chunk);
    else if (key === "maxPendingWrites") assert.equal(observed.maxPending, value);
    else if (["pendingWriteBytesUnchanged", "ownedSnapshotsExact", "bytesExact"].includes(key)) assert.equal(observed.stdout, input.full.join(" ") + "\n");
    else if (key === "acceptedPrefixRetained") { assert(observed.chunks.length === 1 && observed.chunks[0].length > 0); assert.deepEqual(Buffer.concat(observed.chunks), Buffer.from(input.full.join(" ") + "\n").subarray(0, observed.chunks[0].length)); }
    else if (key === "noFurtherWrites") assert.equal(observed.writes, 2);
    else if (key === "noRollback") assert.equal(observed.probe, fullText(input.full));
    else if (key === "allThreeGenuineBuiltins") for (const name of ["pushd", "popd", "dirs"]) assert(new RegExp(`${name}[^\\n]*builtin`).test(observed.stdout));
    else throw new Error(`unimplemented assertion ${row.id}.${key}`);
  }
  assert.deepEqual(observed.snapshots.after.namespace, observed.snapshots.before.namespace, "unexpected namespace/content/mode effects");
  if (observed.status === 0) assert.equal(observed.stderr, "");
  else assert(observed.stderr.includes((row.argv ?? row.argvRecipe ?? ["pushd"])[0]), "command-specific diagnostic missing");
}
async function freshExecs(api, row) {
  const input = { full: ["/c"], env: { PWD: "/c", OLDPWD: "/old" } };
  const fs = await fixture(api, row, input);
  const shell = shellFor(api, fs, input);
  const hold = barrier();
  shell.register({ name: "__ds_hold", async execute() { await hold.hold(); return { exitCode: 0 }; } });
  let first;
  try {
    if (row.id === "S02") { const initial = await shell.exec("pushd -n /a"); assert.equal(initial.exitCode, 0); }
    else { first = shell.exec("pushd -n /a; __ds_hold; dirs -l -p"); await hold.entered; }
    const second = await shell.exec("dirs -l -p");
    assert.equal(second.exitCode, 0);
    assert.equal(second.stdout, row.expect.secondStdout);
    hold.release();
    if (first) { const completed = await first; assert.equal(completed.exitCode, 0); assert.equal(completed.stdout, "/c /a\n" + fullText(row.expect.firstFinalFull)); }
    return { id: row.id, status: "public-assertions-pass", sourceOnlyUnmeasured: {}, actualExecs: 2 };
  } finally { hold.release(); if (first) await first.catch(() => {}); await shell.dispose(); }
}
async function directBoundary(api, row) {
  const input = inputFor(row);
  const fs = await fixture(api, row, input);
  const calls = [];
  let active = false;
  const watched = new Proxy(fs, { get(target, key) { const value = Reflect.get(target, key, target); return typeof value === "function" ? (...args) => { if (active) calls.push(String(key)); return Reflect.apply(value, target, args); } : value; } });
  const shell = shellFor(api, watched, input);
  const sink = boundedSink();
  try {
    if (row.id === "C01") {
      const controller = new AbortController(); controller.abort(false);
      let fulfilled = false;
      active = true;
      try { await shell.exec("pushd /a", { signal: controller.signal }); fulfilled = true; } catch (error) { assert.equal(error, false); }
      assert(!fulfilled);
      assert.deepEqual(calls, []);
    } else if (row.id === "C09") {
      await assert.rejects(shell.exec("pushd /a", { limits: { maxOutputBytes: 5 }, stdout: sink }), (error) => error instanceof api.ShellLimitError && error.limit === "maxOutputBytes");
    } else {
      const pushed = await shell.exec("pushd /a", { limits: { maxCommands: 1 } });
      assert.equal(pushed.exitCode, 0);
      const cd = await shell.exec("cd /a", { limits: { maxCommands: 1 } });
      assert.equal(cd.exitCode, 0);
    }
    return { id: row.id, status: "public-assertions-pass", sourceOnlyUnmeasured: describeCase(row).sourceOnly };
  } finally { await shell.dispose(); }
}
