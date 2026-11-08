import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setImmediate as yieldTurn, setTimeout as delay } from "node:timers/promises";

const rootUrl = import.meta.resolve("virtual-bash");
const treeUrl = import.meta.resolve("virtual-bash/commands/tree");
const packageRoot = resolve(dirname(fileURLToPath(rootUrl)), "..");
const packageManifestPath = join(packageRoot, "package.json");
const packageManifestBytes = await readFile(packageManifestPath);
const packageManifest = JSON.parse(packageManifestBytes.toString("utf8"));
const rootModule = await import("virtual-bash");
const treeModule = await import("virtual-bash/commands/tree");
const { createAgentCommands, createMemoryFileSystem } = rootModule;
const { createTreeCommand } = treeModule;

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const encoder = new TextEncoder();
const ascii = ".\n`-- file\n";
const unicode = ".\n└── file\n";
const checks = [];

function errorRecord(error) {
  return {
    name: error?.name ?? typeof error,
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    actual: error?.actual,
    expected: error?.expected,
    operator: error?.operator,
    observation: error?.observation,
    stack: typeof error?.stack === "string" ? error.stack.split("\n").slice(0, 8) : [],
  };
}

function asserted(observation, assertions) {
  try { assertions(); }
  catch (error) { error.observation = observation; throw error; }
  return observation;
}

async function check(id, operation) {
  try {
    const observation = await operation();
    checks.push({ id, pass: true, observation });
  } catch (error) {
    checks.push({ id, pass: false, error: errorRecord(error) });
  }
}

async function fixture(name = "file") {
  const fs = createMemoryFileSystem();
  await fs.writeFile(`/${name}`, new Uint8Array());
  return fs;
}

async function execute(args, { fs, env = {}, limits = {}, stdout, stderr } = {}) {
  const out = [], err = [];
  const context = {
    command: "tree",
    args,
    cwd: "/",
    env,
    fs: fs ?? createMemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: stdout ?? { async write(bytes) { out.push(bytes.slice()); } },
    stderr: stderr ?? { async write(bytes) { err.push(bytes.slice()); } },
  };
  const result = await createTreeCommand({ limits }).execute(context);
  return {
    exitCode: result.exitCode,
    stdout: Buffer.concat(out).toString("utf8"),
    stderr: Buffer.concat(err).toString("utf8"),
  };
}

await check("package-provenance-and-default-count", async () => {
  const expectedPrefix = pathToFileURL(`${resolve(process.cwd(), "node_modules/virtual-bash")}/`).href;
  const count = createAgentCommands().length;
  const observation = {
    requested: ["virtual-bash", "virtual-bash/commands/tree"],
    resolved: [rootUrl, treeUrl],
    expectedPrefix,
    packageName: packageManifest.name,
    packageVersion: packageManifest.version,
    packageManifestSha256: sha256(packageManifestBytes),
    defaultCommandCount: count,
    treeCommandCount: createAgentCommands().filter(command => command.name === "tree").length,
  };
  assert.equal(packageManifest.name, "virtual-bash");
  assert.ok(rootUrl.startsWith(expectedPrefix), `${rootUrl} must be inside ${expectedPrefix}`);
  assert.ok(treeUrl.startsWith(expectedPrefix), `${treeUrl} must be inside ${expectedPrefix}`);
  assert.equal(count, 70);
  assert.equal(observation.treeCommandCount, 1);
  return observation;
});

await check("wrong-package-load-control", async () => {
  const requestedSpecifier = "virtual-bash-mutation-control-wrong";
  let resolvedUrl = null, resolutionError = null, loadError = null;
  try { resolvedUrl = import.meta.resolve(requestedSpecifier); }
  catch (error) { resolutionError = errorRecord(error); }
  try { await import(requestedSpecifier); }
  catch (error) { loadError = errorRecord(error); }
  const observation = { requestedSpecifier, parentUrl: import.meta.url, resolvedUrl, resolutionError, loadError };
  assert.equal(resolvedUrl, null);
  assert.equal(resolutionError?.code, "ERR_MODULE_NOT_FOUND");
  assert.equal(loadError?.code, "ERR_MODULE_NOT_FOUND");
  return observation;
});

await check("outside-source-load-control", async () => {
  const requestedUrl = pathToFileURL(resolve(process.cwd(), "outside-source-not-installed/index.js")).href;
  let resolvedUrl = null, loadError = null;
  try { resolvedUrl = import.meta.resolve(requestedUrl); }
  catch (error) { resolvedUrl = `resolution-error:${error?.code ?? error}`; }
  try { await import(requestedUrl); }
  catch (error) { loadError = errorRecord(error); }
  const observation = { requestedUrl, parentUrl: import.meta.url, resolvedUrl, loadError };
  assert.equal(resolvedUrl, requestedUrl);
  assert.equal(loadError?.code, "ERR_MODULE_NOT_FOUND");
  assert.ok(!requestedUrl.startsWith(pathToFileURL(`${packageRoot}/`).href));
  return observation;
});

await check("environment-selection", async () => {
  const actual = await execute(["--noreport"], { fs: await fixture(), env: { TREE_CHARSET: "UTF8" } });
  assert.deepEqual(actual, { exitCode: 0, stdout: unicode, stderr: "" });
  return actual;
});

await check("explicit-precedence", async () => {
  const actual = await execute(["--charset=ASCII", "--noreport"], {
    fs: await fixture(), env: { TREE_CHARSET: "UTF8", LC_ALL: "en_US.UTF-8" },
  });
  assert.deepEqual(actual, { exitCode: 0, stdout: ascii, stderr: "" });
  return actual;
});

await check("ambient-host-isolation", async () => {
  const keys = ["TREE_CHARSET", "LC_ALL", "LC_CTYPE", "LANG"];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  let actual;
  try {
    process.env.TREE_CHARSET = "UTF8";
    process.env.LC_ALL = process.env.LC_CTYPE = process.env.LANG = "en_US.UTF-8";
    actual = await execute(["--noreport"], { fs: await fixture(), env: {} });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.deepEqual(actual, { exitCode: 0, stdout: ascii, stderr: "" });
  return actual;
});

await check("inherited-key-isolation", async () => {
  let inheritedReads = 0;
  const prototype = Object.create(null);
  Object.defineProperty(prototype, "TREE_CHARSET", {
    get() { inheritedReads++; return "UTF8"; },
  });
  const env = Object.create(prototype);
  const actual = await execute(["--noreport"], { fs: await fixture(), env });
  const observation = { ...actual, inheritedReads };
  assert.deepEqual(observation, { exitCode: 0, stdout: ascii, stderr: "", inheritedReads: 0 });
  return observation;
});

await check("filename-escaping", async () => {
  const name = "line\nsnow雪";
  const actual = await execute(["--charset=UTF-8", "--noreport"], { fs: await fixture(name) });
  const expected = { exitCode: 0, stdout: ".\n└── line\\nsnow\\351\\233\\252\n", stderr: "" };
  assert.deepEqual(actual, expected);
  assert.equal(actual.stdout.includes(name), false);
  return { actual, expected };
});

await check("utf8-output-byte-cap", async () => {
  const codeUnitCap = unicode.length;
  const encodedBytes = encoder.encode(unicode).byteLength;
  let rejection = null;
  try {
    await execute(["--charset=UTF-8", "--noreport"], {
      fs: await fixture(), limits: { maxOutputBytes: codeUnitCap },
    });
  } catch (error) { rejection = errorRecord(error); }
  const observation = { codeUnitCap, encodedBytes, rejection };
  return asserted(observation, () => {
    assert.ok(encodedBytes > codeUnitCap);
    assert.match(rejection?.message ?? "", /tree output limit exceeded/u);
  });
});

await check("environment-work-cap", async () => {
  const base = createMemoryFileSystem();
  let fsCalls = 0;
  const fs = new Proxy(base, { get(target, property) {
    if (property === "lstat") return async () => { fsCalls++; throw new Error("work admission reached filesystem"); };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let rejection = null, resolved = null;
  try {
    resolved = await execute([], { fs, env: { TREE_CHARSET: "x".repeat(8) }, limits: { maxSteps: 8 } });
  } catch (error) { rejection = errorRecord(error); }
  const observation = { envCodeUnits: 8, admittedCharge: 9, maxSteps: 8, fsCalls, rejection, resolved };
  return asserted(observation, () => {
    assert.equal(fsCalls, 0);
    assert.match(rejection?.message ?? "", /tree work limit exceeded/u);
    assert.equal(resolved, null);
  });
});

await check("awaited-backpressure", async () => {
  let enterFirst;
  const firstEntered = new Promise(resolveFirst => { enterFirst = resolveFirst; });
  let releaseWrites;
  const released = new Promise(resolveRelease => { releaseWrites = resolveRelease; });
  const writes = [];
  const pendingWrites = [];
  let outstanding = 0, commandSettled = false, settlementSnapshot = null;
  const sink = { write(bytes) {
    const record = {
      index: writes.length,
      bytes: bytes.byteLength,
      enteredWithCommandSettled: commandSettled,
      closedWithCommandSettled: null,
      closed: false,
    };
    writes.push(record);
    outstanding++;
    if (writes.length === 1) enterFirst();
    const pending = released.then(() => {
      record.closedWithCommandSettled = commandSettled;
      record.closed = true;
      outstanding--;
    });
    pendingWrites.push(pending);
    return pending;
  } };
  const command = execute(["--charset=UTF-8", "--noreport"], { fs: await fixture(), stdout: sink });
  void command.finally(() => {
    commandSettled = true;
    settlementSnapshot = { writeCount: writes.length, outstanding };
  }).catch(() => undefined);
  await Promise.race([firstEntered, delay(1000).then(() => { throw new Error("first sink write timeout"); })]);
  await yieldTurn();
  const beforeRelease = { commandSettled, writeCount: writes.length, outstanding };
  releaseWrites();
  const result = await Promise.race([command, delay(1000).then(() => { throw new Error("command settlement timeout"); })]);
  await Promise.all(pendingWrites);
  await yieldTurn();
  const afterRelease = {
    commandSettled,
    writeCount: writes.length,
    outstanding,
    allWritesClosed: writes.every(write => write.closed),
    lateWriteCount: writes.filter(write => write.enteredWithCommandSettled).length,
    lateCompletionCount: writes.filter(write => write.closedWithCommandSettled).length,
    settlementSnapshot,
  };
  const observation = { beforeRelease, afterRelease, writes, result };
  return asserted(observation, () => {
    assert.deepEqual(beforeRelease, { commandSettled: false, writeCount: 1, outstanding: 1 });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(afterRelease, {
      commandSettled: true,
      writeCount: 2,
      outstanding: 0,
      allWritesClosed: true,
      lateWriteCount: 0,
      lateCompletionCount: 0,
      settlementSnapshot: { writeCount: 2, outstanding: 0 },
    });
  });
});

process.stdout.write(`${JSON.stringify({
  schema: 1,
  variant: process.env.MUTATION_VARIANT ?? "unknown",
  pid: process.pid,
  assertionPlan: checks.map(({ id }) => id),
  checks,
  passed: checks.filter(item => item.pass).length,
  failed: checks.filter(item => !item.pass).length,
  pass: checks.every(item => item.pass),
}, null, 2)}\n`);
