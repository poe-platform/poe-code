import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as root from "virtual-bash";
import * as which from "virtual-bash/commands/which";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const encoder = new TextEncoder();
const rows = [];
const pending = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };
const proxy = (filesystem, overrides) => new Proxy(filesystem, { get(target, key) {
  if (Object.hasOwn(overrides, key)) return overrides[key];
  const value = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
} });
const filesystem = async () => {
  const fs = new root.MemoryFileSystem();
  for (const directory of ["/bin", "/alt", "/work", "/tree"]) await fs.mkdir(directory);
  for (const name of ["slowA", "slowB", "fast", "tool"]) await fs.writeFile(`/bin/${name}`, encoder.encode("x"), { mode: 0o777 });
  await fs.writeFile("/alt/tool", encoder.encode("y"), { mode: 0o777 });
  return fs;
};
const setup = (fs, options = {}) => {
  const shell = new root.Shell({ fs, cwd: "/work", env: { PATH: "/bin:/alt", HOME: "/work" }, limits: { maxCommands: 100, maxOutputBytes: 65536 } });
  shell.use(root.agentCommands(options));
  return shell;
};
const sink = () => { const chunks = []; return { write: async chunk => { chunks.push(Buffer.from(chunk)); }, text: () => Buffer.concat(chunks).toString() }; };
async function cancellationCase(id) {
  const fs = await filesystem(), gate = pending(), caller = new AbortController(), local = new AbortController();
  const localReason = Object.freeze({ source: `${id}-invoke` }), callerReason = Object.freeze({ source: `${id}-caller` });
  const events = [], required = id === "C04" ? 2 : 1;
  let admitted = 0, activeListeners = 0, cleanupCalls = 0, parentLive;
  const view = proxy(fs, { stat: async (path, options) => {
    if (!/^\/bin\/slow[AB]$/u.test(path)) return fs.stat(path, options);
    const signal = options?.signal;
    assert.ok(signal instanceof AbortSignal);
    events.push({ kind: "stat-enter", path, aborted: signal.aborted });
    admitted++;
    if (admitted === required) gate.resolve();
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        activeListeners--;
        events.push({ kind: "stat-abort", path, localReason: signal.reason === localReason, callerReason: signal.reason === callerReason });
        reject(signal.reason);
      };
      signal.throwIfAborted();
      activeListeners++;
      signal.addEventListener("abort", abort, { once: true });
    });
  } });
  const shell = setup(view), childOut = sink(), siblingOut = sink();
  const timer = setTimeout(() => caller.abort(new Error("INDEPENDENT_TEST_WATCHDOG")), 1800);
  let first, second;
  shell.register({ name: "relay", async execute(context) {
    const handlerDone = pending();
    context.registerCleanup(async () => { cleanupCalls++; await handlerDone.promise; });
    try {
    const capture = promise => promise.then(value => ({ kind: "result", value }), error => ({ kind: "rejection", error }));
    const child = capture(context.invoke("which", ["slowA"], { signal: local.signal, stdout: childOut,
      ...(id === "C07" ? { env: { OPTIND: "1" } } : {}) }));
    const sibling = id === "C03" ? capture(context.invoke("which", ["fast"], { stdout: siblingOut }))
      : id === "C04" ? capture(context.invoke("which", ["slowB"], { stdout: siblingOut })) : undefined;
    await gate.promise;
    if (id === "C04") caller.abort(callerReason);
    else local.abort(localReason);
    first = await child;
    second = sibling ? await sibling : undefined;
    parentLive = !context.signal.aborted;
    assert.equal(first.kind, "rejection");
    assert.equal(first.error, id === "C04" ? callerReason : localReason);
    if (id === "C03") { assert.equal(second.kind, "result"); assert.equal(second.value.exitCode, 0); }
    if (id === "C04") { assert.equal(second.kind, "rejection"); assert.equal(second.error, callerReason); }
    return { exitCode: 0 };
    } finally { handlerDone.resolve(); }
  } });
  let output, outerReason;
  try {
    const script = id === "C07" ? "getopts ab first -ab; relay; getopts ab second -ab; printf '%s:%s:%s\\n' \"$first\" \"$second\" \"$OPTIND\"" : "relay; pwd";
    try { output = await shell.exec(script, { signal: caller.signal }); }
    catch (error) { outerReason = error; }
    if (id === "C04") { assert.equal(outerReason, callerReason); assert.equal(parentLive, false); }
    else {
      assert.equal(outerReason, undefined);
      assert.equal(output.exitCode, 0);
      assert.equal(output.stdout, id === "C07" ? "a:b:2\n" : "/work\n");
      assert.equal(output.stderr, "");
      assert.equal(parentLive, true);
      assert.equal(caller.signal.aborted, false);
    }
    assert.equal(activeListeners, 0);
    assert.equal(cleanupCalls, 1);
    assert.equal(childOut.text(), "");
    assert.equal(siblingOut.text(), id === "C03" ? "/bin/fast\n" : "");
    return { events, admitted, activeListeners, cleanupCalls, parentLive, exactInnerReason: true,
      exactCallerReason: id === "C04" ? outerReason === callerReason : undefined, output: output?.stdout, sibling: siblingOut.text() };
  } finally { clearTimeout(timer); await shell.dispose(); }
}

const implementations = {
  async C01() {
    for (const name of ["createWhichCommand", "createWhichCommands", "whichCommands"]) assert.equal(root[name], which[name]);
    assert.deepEqual(root.createAgentCommands().map(command => command.name).sort(), input.expected77);
    const shell = setup(await filesystem());
    try {
      const observed = await shell.exec("type getopts; type which");
      assert.equal(observed.exitCode, 0);
      assert.match(observed.stdout, /getopts is a shell builtin/u);
      assert.ok(!shell.commands.has("getopts") && !shell.commands.has("curl") && !shell.commands.has("safejs"));
      assert.equal(shell.commands.list().length, 77);
      return { names: 77, discovery: observed.stdout, root: import.meta.resolve("virtual-bash"), which: import.meta.resolve("virtual-bash/commands/which") };
    } finally { await shell.dispose(); }
  },
  C02: () => cancellationCase("C02"),
  C03: () => cancellationCase("C03"),
  C04: () => cancellationCase("C04"),
  async C05() {
    const fs = await filesystem(), events = [];
    const shell = setup(proxy(fs, { stat: async (path, options) => { events.push(path); return fs.stat(path, options); } }));
    let invalidType = false, callsAtFailure;
    shell.register({ name: "invalid_then_valid", async execute(context) {
      try { await context.invoke("which", ["fast"], { signal: 42 }); }
      catch (error) { invalidType = error instanceof TypeError; }
      callsAtFailure = events.length;
      const result = await context.invoke("which", ["fast"], { signal: undefined });
      assert.equal(result.exitCode, 0);
      return { exitCode: 0 };
    } });
    try {
      const output = await shell.exec("invalid_then_valid; pwd");
      assert.equal(invalidType, true); assert.equal(callsAtFailure, 0);
      assert.equal(output.exitCode, 0); assert.equal(output.stdout, "/bin/fast\n/work\n"); assert.equal(output.stderr, "");
      return { invalidType, callsAtFailure, events };
    } finally { await shell.dispose(); }
  },
  async C06() {
    const fs = await filesystem(), events = [];
    const view = proxy(fs, { capabilities: { ...fs.capabilities, readOnly: true },
      stat: async (path, options) => { events.push(`stat:${path}`); return { ...await fs.stat(path, options), mode: 0 }; },
      access: async (path, mode, options) => {
        options?.signal?.throwIfAborted(); events.push(`access:${path}:${mode}`);
        if (path === "/bin/tool") throw new root.FsError("EACCES", path);
      } });
    const shell = setup(view);
    try {
      const result = await shell.exec("which tool");
      assert.equal(result.exitCode, 0); assert.equal(result.stdout, "/alt/tool\n"); assert.equal(result.stderr, "");
      assert.deepEqual(events, ["stat:/bin/tool", "access:/bin/tool:1", "stat:/alt/tool", "access:/alt/tool:1"]);
      return { events, output: result.stdout };
    } finally { await shell.dispose(); }
  },
  C07: () => cancellationCase("C07"),
  async C08() {
    const fs = await filesystem();
    await fs.writeFile("/tree/a", encoder.encode("abc")); await fs.writeFile("/tree/b", encoder.encode("de"));
    let contentReads = 0, mutations = 0, owned = false;
    const view = proxy(fs, { readFile: (...args) => { contentReads++; return fs.readFile(...args); }, readStream: (...args) => { contentReads++; return fs.readStream(...args); },
      writeFile: (...args) => { mutations++; return fs.writeFile(...args); }, rm: (...args) => { mutations++; return fs.rm(...args); } });
    const shell = setup(view), caller = new AbortController();
    shell.use(async (context, next) => { if (context.command === "du") owned = context.stdout.ownedOutput !== undefined; return next(); });
    try {
      const output = await shell.exec("du -a -b /tree | head -n 1; printf 'next\\n'", { signal: caller.signal });
      assert.equal(output.exitCode, 0); assert.equal(output.stdout, "3\t/tree/a\nnext\n"); assert.equal(output.stderr, "");
      assert.equal(owned, true); assert.equal(contentReads, 0); assert.equal(mutations, 0); assert.equal(caller.signal.aborted, false);
      assert.equal(Buffer.from(await fs.readFile("/tree/a")).toString(), "abc"); assert.equal(Buffer.from(await fs.readFile("/tree/b")).toString(), "de");
      return { owned, contentReads, mutations, output: output.stdout };
    } finally { await shell.dispose(); }
  },
  async C09() {
    const fs = await filesystem(), original = "<p>alpha</p><p>beta</p>";
    await fs.writeFile("/doc.html", encoder.encode(original));
    let acquisitions = 0, releases = 0, owned = false;
    const view = proxy(fs, { readStream: (path, options) => ({ async *[Symbol.asyncIterator]() {
      acquisitions++;
      try { yield* fs.readStream(path, options); } finally { releases++; }
    } }) });
    const shell = setup(view), caller = new AbortController();
    shell.use(async (context, next) => { if (context.command === "html-to-markdown") owned = context.stdout.ownedOutput !== undefined; return next(); });
    try {
      const output = await shell.exec("html-to-markdown /doc.html | head -n 1; printf kept > /after; printf 'err\\n' >&2; printf 'next\\n'", { signal: caller.signal });
      assert.equal(output.exitCode, 0); assert.equal(output.stdout, "alpha\nnext\n"); assert.equal(output.stderr, "err\n");
      assert.equal(owned, true); assert.equal(acquisitions, 1); assert.equal(releases, 1); assert.equal(caller.signal.aborted, false);
      assert.equal(Buffer.from(await fs.readFile("/doc.html")).toString(), original); assert.equal(Buffer.from(await fs.readFile("/after")).toString(), "kept");
      return { owned, acquisitions, releases, output: output.stdout, stderr: output.stderr, inputPreserved: true, filePreserved: true };
    } finally { await shell.dispose(); }
  },
  async C10() {
    const fs = await filesystem(), events = [];
    const view = proxy(fs, { stat: async (path, options) => { events.push(path); return fs.stat(path, options); } });
    const shell = setup(view, { which: { limits: { maxProbes: 1 } } });
    shell.register({ name: "probe_limit", execute: context => context.invoke("which", ["missing"]) });
    try {
      const output = await shell.exec("probe_limit");
      assert.equal(output.exitCode, 1); assert.equal(output.stdout, ""); assert.match(output.stderr, /maxProbes/u);
      assert.deepEqual(events, ["/bin/missing"]);
      const replacement = new root.Shell({ fs, env: { PATH: "/bin" } });
      replacement.register({ name: "which", execute: () => ({ exitCode: 93 }) });
      replacement.use(root.agentCommands({ replace: true, which: { replace: false } }));
      try { const result = await replacement.exec("which /bin/fast"); assert.equal(result.exitCode, 0); assert.equal(result.stdout, "/bin/fast\n"); }
      finally { await replacement.dispose(); }
      return { events, boundedDiagnostic: output.stderr, topLevelReplaceWins: true };
    } finally { await shell.dispose(); }
  },
};
for (const id of input.ids) {
  try { rows.push({ id, status: "PASS", details: await implementations[id]() }); }
  catch (error) { rows.push({ id, status: "FAIL", error: { name: error?.name, message: error?.message, stack: error?.stack } }); }
}
console.log(JSON.stringify({ layout: input.layout, root: import.meta.resolve("virtual-bash"), rows }));
if (rows.some(row => row.status !== "PASS")) process.exitCode = 1;
