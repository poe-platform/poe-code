import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { get } from "node:http";
import path from "node:path";
import { errorRecord } from "./audit-common.mjs";
import "./trace-register.mjs";

const [inputPath, engine, caseId] = process.argv.slice(2);
const inputs = JSON.parse(readFileSync(inputPath, "utf8"));
const specimen = [...inputs.cases, ...inputs.diagnostics].find(candidate => candidate.id === caseId);
const report = { engine, caseId, pid: process.pid, phase: "loading", runtime: { node: process.version, executable: realpathSync(process.execPath), argv: process.execArgv }, captureErrors: [], networkRequests: [] };
const send = value => process.send?.(value);
const mark = phase => { report.phase = phase; send({ kind: "phase", phase }); };
let shell;
let vfs;
let product;
let timer;

function metadata(stat) {
  return Object.fromEntries(Reflect.ownKeys(stat).map(key => {
    const value = stat[key];
    return [String(key), value instanceof Date ? { dateISO: value.toISOString(), epochMs: value.getTime() } : typeof value === "bigint" ? { bigint: String(value) } : value !== null && typeof value === "object" || typeof value === "symbol" ? { opaque: typeof value, comparable: false } : value];
  }));
}
async function census() {
  const observation = { entries: [], errors: [], complete: true, bytes: 0 };
  const visit = async (filename, depth) => {
    try {
      if (depth > inputs.budgets.maxDepth || observation.entries.length >= inputs.budgets.maxEntries) throw new Error("census entry/depth limit");
      const stat = await vfs.lstat(filename);
      const type = engine === "ours" ? stat.type : stat.isSymbolicLink ? "symlink" : stat.isDirectory ? "directory" : stat.isFile ? "file" : "unknown";
      const entry = { path: filename, type, rawMetadata: metadata(stat) };
      if (typeof stat.mode === "number") entry.mode = stat.mode;
      if (typeof stat.size === "number") entry.size = stat.size;
      observation.entries.push(entry);
      if (type === "symlink") entry.target = await vfs.readlink(filename);
      else if (type === "file") {
        if (observation.bytes + stat.size > inputs.budgets.maxCensusBytes) throw new Error("census byte limit");
        const bytes = engine === "ours" ? await vfs.readFile(filename, { maxBytes: inputs.budgets.maxCensusBytes - observation.bytes }) : await vfs.readFileBuffer(filename);
        observation.bytes += bytes.length;
        entry.base64 = Buffer.from(bytes).toString("base64");
      } else if (type === "directory") {
        const names = (await vfs.readdir(filename)).map(value => typeof value === "string" ? value : value.name).sort();
        for (const name of names) {
          if (!name || name.includes("/") || name === "." || name === "..") throw new Error(`unsafe census entry ${name}`);
          await visit(path.posix.join(filename, name), depth + 1);
        }
      } else throw new Error(`unknown VFS type ${filename}`);
    } catch (error) {
      observation.complete = false;
      observation.errors.push({ path: filename, error: errorRecord(error) });
    }
  };
  await visit("/", 0);
  return observation;
}
async function setupFixtures() {
  for (const directory of ["/fixture", "/tmp", "/home/user", ...specimen.directories.map(name => `/fixture/${name}`)]) await vfs.mkdir(directory, { recursive: true });
  for (const [relative, file] of Object.entries(specimen.files)) {
    const filename = `/fixture/${relative}`;
    await vfs.mkdir(path.posix.dirname(filename), { recursive: true });
    await vfs.writeFile(filename, Buffer.from(file.base64, "base64"));
    if (file.mode !== undefined) await vfs.chmod(filename, file.mode);
  }
  for (const [relative, target] of Object.entries(specimen.symlinks)) await vfs.symlink(target, `/fixture/${relative}`);
}
function baselineFetch(url, options = {}) {
  const request = { url, method: options.method ?? "GET" };
  report.networkRequests.push(request);
  if (url !== inputs.network.url || request.method !== "GET" || options.body !== undefined) throw new Error("Exact local fixture policy denied request");
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const outgoing = get(url, { agent: false, signal: options.signal, timeout: 3000 }, incoming => {
      incoming.on("data", chunk => {
        total += chunk.length;
        if (total > 65536) incoming.destroy(new Error("response byte limit"));
        else chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => resolve({ status: incoming.statusCode, statusText: incoming.statusMessage ?? "", headers: Object.fromEntries(Object.entries(incoming.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)])), body: new Uint8Array(Buffer.concat(chunks)), url }));
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("fixture transport timeout")));
    outgoing.on("error", reject);
  });
}

try {
  product = await import(pathToFileURL(engine === "ours" ? inputs.paths.oursEntry : inputs.paths.baselineEntry).href);
  mark("constructor");
  const env = { ...inputs.environment, ...specimen.env };
  const duration = specimen.budgetMs;
  report.configuration = inputs.configurations[engine][specimen.configuration];
  if (engine === "ours") {
    vfs = product.createMemoryFileSystem();
    shell = new product.Shell({ fs: vfs, cwd: specimen.cwd, env, limits: inputs.configurations.ours.default.limits });
    shell.use(product.agentCommands());
    if (specimen.configuration === "loopback-network") shell.use(product.networkCommands({
      authorize(request) {
        report.networkRequests.push({ url: request.url, method: request.method, attempt: request.attempt });
        return request.url === inputs.network.url && request.method === "GET";
      },
      limits: inputs.configurations.ours[specimen.configuration].networkLimits,
    }));
    await new Promise(resolve => setImmediate(resolve));
    report.registeredNames = shell.commands.list().map(definition => definition.name).sort();
    report.kernelSource = inputs.dispatch.ours;
  } else {
    vfs = new product.InMemoryFs();
    const configuration = inputs.configurations.baseline[specimen.configuration];
    const options = { ...configuration, fs: vfs, cwd: specimen.cwd, env };
    delete options.transportPolicy;
    if (specimen.configuration === "loopback-network") options.fetch = baselineFetch;
    shell = new product.Bash(options);
    report.kernelSource = inputs.dispatch.baseline;
  }
  mark("fixture-setup");
  await setupFixtures();
  report.before = await census();
  mark("product-exec");
  const controller = new AbortController();
  timer = setTimeout(() => controller.abort(new Error(`audit product budget ${duration}ms`)), duration);
  const start = performance.now();
  try {
    const result = await shell.exec(specimen.effectiveScript, engine === "ours" ? {
      cwd: specimen.cwd, env, stdin: Buffer.from(specimen.stdinBase64, "base64"), signal: controller.signal,
    } : {
      cwd: specimen.cwd, env, replaceEnv: true, rawScript: true, stdin: Buffer.from(specimen.stdinBase64, "base64").toString("latin1"), stdinKind: "bytes", signal: controller.signal,
    });
    report.productElapsedMs = performance.now() - start;
    report.result = {
      exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
      stdoutKind: result.stdoutKind ?? null, stdoutEncoding: result.stdoutEncoding ?? null,
      stdoutBase64: engine === "ours" ? Buffer.from(result.stdoutBytes).toString("base64") : Buffer.from(product.stdoutAsBytes(result), "latin1").toString("base64"),
      stderrBase64: engine === "ours" ? Buffer.from(result.stderrBytes).toString("base64") : Buffer.from(result.stderr, "utf8").toString("base64"),
      stdoutBoundary: engine === "ours" ? "raw ShellResult.stdoutBytes Uint8Array" : "public stdoutAsBytes ByteString encoded Latin-1; not inferred from text",
      stderrBoundary: engine === "ours" ? "raw ShellResult.stderrBytes Uint8Array" : "derived UTF-8 of public stderr string; no raw byte API",
    };
  } catch (error) {
    report.productElapsedMs = performance.now() - start;
    report.executionError = errorRecord(error);
  } finally { clearTimeout(timer); }
  mark("after-census");
  report.after = await census();
  if (engine === "ours") report.registeredNamesAfter = shell.commands.list().map(definition => definition.name).sort();
} catch (error) {
  report.captureErrors.push({ phase: report.phase, error: errorRecord(error) });
} finally {
  clearTimeout(timer);
  mark("cleanup");
  try {
    if (engine === "ours" && shell) await shell.dispose();
    report.cleanup = { disposed: engine === "ours" && Boolean(shell), baselineDisposeAPI: false, completion: "returned" };
  } catch (error) { report.cleanup = { error: errorRecord(error) }; }
  report.commonJsModules = Object.keys(createRequire(import.meta.url).cache).sort();
  report.memoryUsageAtEnd = process.memoryUsage();
  report.phase = "complete";
  await new Promise((resolve, reject) => process.send({ kind: "result", report }, error => error ? reject(error) : resolve()));
  process.disconnect?.();
}
