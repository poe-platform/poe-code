import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { posix, join } from "node:path";
import { pathToFileURL } from "node:url";
import { decode, encode, environment, fixedTime, fixtureRoot, maximumBytes, projectBytes, relativePath, snapshot } from "./common.mjs";

const engine = process.env.EXPANDED_ENGINE;
const sourceRoot = process.env.EXPANDED_SOURCE_ROOT;
const baselineRoot = process.env.EXPANDED_BASELINE_ROOT;
let library;
try {
  if (engine === "virtual-bash") library = await import(pathToFileURL(join(sourceRoot, "src/index.ts")).href);
  else {
    const pkg = JSON.parse(await readFile(join(baselineRoot, "package.json"), "utf8"));
    assert.equal(pkg.version, "3.4.2");
    library = await import(pathToFileURL(join(baselineRoot, "dist/bundle/index.js")).href);
  }
  process.send?.({ ready: true });
} catch (error) { process.send?.({ ready: false, error: String(error.stack ?? error) }); }

async function observe(specimen, baseUrl, instrument, warmup = 0) {
  const fs = engine === "virtual-bash" ? library.createMemoryFileSystem() : new library.InMemoryFs();
  await fs.mkdir(fixtureRoot, { recursive: true });
  await fs.chmod(fixtureRoot, 0o755);
  for (const path of specimen.directories) { const target = `${fixtureRoot}/${relativePath(path)}`; await fs.mkdir(target, { recursive: true }); await fs.chmod(target, 0o755); }
  for (const [path, bytes] of Object.entries(specimen.files)) {
    const target = `${fixtureRoot}/${relativePath(path)}`, parent = posix.dirname(target);
    await fs.mkdir(parent, { recursive: true });
    let directory = parent;
    while (directory !== fixtureRoot && directory !== "/") { await fs.chmod(directory, 0o755); directory = posix.dirname(directory); }
    await fs.writeFile(target, decode(bytes)); await fs.chmod(target, specimen.fileModes[path] ?? 0o644);
    const time = specimen.fileTimes?.[path] ?? fixedTime;
    await fs.utimes(target, engine === "virtual-bash" ? time : new Date(time), engine === "virtual-bash" ? time : new Date(time));
  }
  const events = [], registryEvents = [];
  let shell, execute, dispose;
  if (engine === "virtual-bash") {
    const commands = new library.CommandRegistry();
    shell = new library.Shell({ fs, commands, cwd: fixtureRoot, env: environment,
      limits: { maxOutputBytes: maximumBytes, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } }).use(library.agentCommands());
    if (specimen.network) shell.use(library.networkCommands({ authorize({ url }) { const parsed = new URL(url); return parsed.origin === baseUrl && parsed.hostname === "127.0.0.1"; } }));
    if (instrument) shell.use(async (context, next) => { events.push({ name: context.command, args: [...context.args] }); return next(); });
    await shell.exec("");
    if (instrument) for (const definition of commands.list()) commands.register({ ...definition, execute(context) {
      registryEvents.push({ name: definition.name, args: [...context.args] }); return definition.execute(context);
    } }, { replace: true });
    execute = async () => {
      const result = await shell.exec(specimen.script.replaceAll("{{BASE}}", baseUrl ?? "network-unavailable"), { stdin: decode(specimen.stdin), signal: AbortSignal.timeout(5000) });
      return { stdout: Buffer.from(result.stdoutBytes), stderr: Buffer.from(result.stderrBytes), exitCode: result.exitCode };
    };
    dispose = () => shell.dispose();
  } else {
    shell = new library.Bash({ fs, cwd: fixtureRoot, env: environment,
      executionLimits: { maxOutputSize: maximumBytes, maxCommandCount: 10000, maxLoopIterations: 10000, maxExecutionTimeMs: 5000 },
      ...(specimen.network ? { network: { allowedUrlPrefixes: [baseUrl], allowedMethods: ["GET", "HEAD", "POST", "PUT"], denyPrivateRanges: false, maxResponseSize: maximumBytes, timeoutMs: 4000 } } : {}) });
    if (instrument) for (const [name, definition] of shell.commands) shell.commands.set(name, { ...definition, execute(...args) {
      registryEvents.push({ name, args: [...args[0]] }); return definition.execute(...args);
    } });
    execute = async () => {
      const result = await shell.exec(specimen.script.replaceAll("{{BASE}}", baseUrl ?? "network-unavailable"), {
        stdin: decode(specimen.stdin).toString("latin1"), stdinKind: "bytes", rawScript: true,
        replaceEnv: true, env: environment, signal: AbortSignal.timeout(5000),
      });
      return { stdout: Buffer.from(library.latin1FromBytes(library.stdoutAsBytes(result)), "latin1"), stderr: Buffer.from(result.stderr, "utf8"), exitCode: result.exitCode };
    };
    dispose = async () => {};
  }
  try {
    for (let count = 0; count < warmup; count++) await execute();
    global.gc?.();
    const before = process.memoryUsage();
    const sampledPeak = { rss: before.rss, heapUsed: before.heapUsed, external: before.external };
    const sample = () => { const usage = process.memoryUsage(); for (const key of Object.keys(sampledPeak)) sampledPeak[key] = Math.max(sampledPeak[key], usage[key]); };
    const timer = setInterval(sample, 2);
    let result, executeMs;
    try { const start = performance.now(); result = await execute(); executeMs = performance.now() - start; sample(); }
    finally { clearInterval(timer); }
    const after = process.memoryUsage();
    const replacements = baseUrl ? [[baseUrl, "{{BASE}}"]] : [];
    const entries = await snapshot(engine === "virtual-bash" ? {
      list: async path => (await fs.readdir(path)).map(entry => entry.name), stat: path => fs.lstat(path), read: path => fs.readFile(path), link: path => fs.readlink(path),
    } : { list: path => fs.readdir(path), read: path => fs.readFileBuffer(path), link: path => fs.readlink(path), stat: async path => {
      const info = await fs.lstat(path); return { type: info.isSymbolicLink ? "symlink" : info.isDirectory ? "directory" : info.isFile ? "file" : "other", mode: info.mode };
    } }, specimen, fixtureRoot, replacements);
    return { stdout: encode(projectBytes(result.stdout, replacements)), stderr: encode(projectBytes(result.stderr, replacements)), exitCode: result.exitCode, entries,
      events, registryEvents, executeMs, memory: { before, after, sampledPeak, processMaxRssKiB: process.resourceUsage().maxRSS, sampleIntervalMs: 2 },
      capture: engine === "virtual-bash" ? "native Uint8Array stdout/stderr" : "public stdoutAsBytes/latin1FromBytes; stderr UTF8 public text" };
  } finally { await dispose(); }
}

process.on("message", async message => {
  try { const observation = await observe(message.specimen, message.baseUrl, message.instrument ?? true, message.warmup ?? 0); process.send?.({ id: message.id, observation }, () => {}); }
  catch (error) { process.send?.({ id: message.id, error: String(error.stack ?? error) }, () => {}); }
});
