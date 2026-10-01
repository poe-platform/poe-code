import { Shell, createMemoryFileSystem, networkCommands as rootNetwork, nodeCommands as rootNode } from "@poe-platform/safe-bash";
import { networkCommands as coreNetwork, safeJsCommands } from "@poe-platform/safe-bash/core";
import { networkCommands } from "@poe-platform/safe-bash/commands/network";
import { nodeCommands } from "@poe-platform/safe-bash/commands/node";
import { run, Budget, makeFsModule, declareHostOperation } from "@poe-platform/safe-js/workerd";

function check(ok, message) { if (!ok) throw new Error(message); }
function equal(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
}
function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}
const payload = new Uint8Array([0, 255, 195, 169, 240, 159, 152, 128]);
const encoder = new TextEncoder();

async function verifyNetwork(plugin) {
  const requests = [];
  let disposed = 0;
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", payload);
  await fs.writeFile("/headers", encoder.encode("X-Part: portable\n"));
  const shell = new Shell({ fs }).use(plugin({
    limits: { maxUrls: 8, maxBufferBytes: 65536 }, authorize: () => true,
    async transport(request) {
      const body = [];
      if (request.body) for await (const bytes of request.body) body.push(...bytes);
      requests.push({ url: request.url, method: request.method, headers: request.headers, body });
      return { status: 200, statusText: "OK", headers: [],
        body: (async function* () { yield payload.subarray(0, 3); yield payload.subarray(3); })(),
        async dispose() { disposed++; } };
    },
  }));
  try {
    for (const command of [
      "curl -s -o /curl https://offline.invalid/file",
      "wget -q -O /wget https://offline.invalid/file",
      "curl -s -o /post -u 'é:p' -d 'é😀' https://offline.invalid/post",
      "curl -s -o /binary --data-binary @/input https://offline.invalid/post",
      "curl -s -o /form -F 'file=@/input;headers=@/headers' https://offline.invalid/form",
    ]) {
      const result = await shell.exec(command);
      check(result.exitCode === 0 && result.stderr === "", `${command}: ${JSON.stringify(result)}`);
    }
    for (const file of ["/curl", "/wget", "/post", "/binary", "/form"])
      equal([...await fs.readFile(file)], [...payload], file + " response bytes");
    equal(requests[2].body, [...encoder.encode("é😀")], "UTF-8 request body");
    check(requests[2].headers.some(([name, value]) => name.toLowerCase() === "authorization" && value === "Basic w6k6cA=="), "UTF-8 basic authentication");
    equal(requests[3].body, [...payload], "binary upload");
    const form = new TextDecoder().decode(new Uint8Array(requests[4].body));
    check(form.includes("X-Part: portable\r\n"), "multipart headers from VFS");
    const start = requests[4].body.findIndex((_, index, bytes) => payload.every((value, offset) => bytes[index + offset] === value));
    check(start >= 0, "multipart binary upload");
    const globbed = await shell.exec("curl -s -o '/glob#1' 'https://offline.invalid/[1-2]'");
    check(globbed.exitCode === 0, "URL glob: " + globbed.stderr);
    equal(requests.slice(5).map(request => request.url), ["https://offline.invalid/1", "https://offline.invalid/2"], "URL expansion");
    equal([...await fs.readFile("/glob2")], [...payload], "expanded output file");
    equal(disposed, requests.length, "every response disposed before command settlement");
  } finally { await shell.dispose(); }

  let effects = 0;
  const limited = new Shell({ fs }).use(plugin({
    limits: { maxUrls: 1, maxBufferBytes: 64 },
    authorize: () => { effects++; return true; },
    async transport() { effects++; throw new Error("unadmitted transport"); },
  }));
  try {
    for (const command of ["curl 'https://offline.invalid/[1-2]'", `wget -O - 'https://offline.invalid/${"é".repeat(40)}'`])
      equal((await limited.exec(command)).exitCode, 2, "finite network admission");
    equal(effects, 0, "quota rejection before host effects");
  } finally { await limited.dispose(); }

  for (const command of ["curl https://offline.invalid/blocked", "wget -O - https://offline.invalid/blocked"]) {
    const started = deferred();
    const blocked = deferred();
    const cleanup = deferred();
    const cleaning = deferred();
    let returns = 0;
    let disposals = 0;
    const controller = new AbortController();
    const reason = new Error("cancel network");
    const cancelled = new Shell({ fs }).use(plugin({
      limits: { maxUrls: 1, maxBufferBytes: 1024 }, authorize: () => true,
      async transport() {
        return { status: 200, statusText: "OK", headers: [], body: { [Symbol.asyncIterator]() { return {
          next() { started.resolve(); return blocked.promise; },
          async return() { returns++; return { done: true }; },
        }; } }, async dispose() { disposals++; cleaning.resolve(); await cleanup.promise; } };
      },
    }));
    let settled = false;
    const task = cancelled.exec(command, { signal: controller.signal }).then(
      () => { settled = true; throw new Error("cancellation was swallowed"); },
      error => { settled = true; check(error === reason, "network cancellation identity"); },
    );
    try {
      await started.promise;
      controller.abort(reason);
      await cleaning.promise;
      check(!settled, "command settled before response cleanup");
      cleanup.resolve();
      await task;
      equal([returns, disposals], [1, 1], "cancelled response cleanup");
    } finally {
      controller.abort(reason); cleanup.resolve(); blocked.resolve({ done: true });
      await task; await cancelled.dispose();
    }
  }
}

async function verifyNode(plugin) {
  const runtime = { run, createBudget: options => new Budget(options), makeFsModule, declareHostOperation };
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(plugin({ runtime }));
  try {
    const consoleResult = await shell.exec('node -e "console.log(1 + 2)"');
    equal([consoleResult.exitCode, consoleResult.stdout, consoleResult.stderr], [0, "3\n", ""], "real SafeJS console");
    const source = 'import { readText, writeBytes } from "stdio"; import { writeFile } from "fs"; console.log({text: await readText()}); await writeFile("/written", "é😀"); await writeBytes([0,255,195,169]);';
    await fs.writeFile("/script.js", encoder.encode(source));
    const chunks = [];
    const result = await shell.exec("node /script.js", { stdin: (async function* () {
      const bytes = encoder.encode("é😀"); yield bytes.subarray(0, 1); yield bytes.subarray(1, 4); yield bytes.subarray(4);
    })(), stdout: { async write(bytes) { chunks.push(...bytes); } } });
    equal(result.exitCode, 0, "guest text and byte IO: " + result.stderr);
    equal(chunks, [...encoder.encode('{"text":"é😀"}\n'), 0, 255, 195, 169], "guest IO bytes");
    equal([...await fs.readFile("/written")], [...encoder.encode("é😀")], "guest VFS write");
  } finally { await shell.dispose(); }
  for (const [limits, command, stdin, diagnostic] of [
    [{ maxOutputBytes: 3 }, 'node -e \'console.log("é")\'', "", undefined],
    [{ maxOutputBytes: 2 }, 'node -e \'console.log("é")\'', "", "maxOutputBytes"],
    [{ maxInputBytes: 1 }, 'node -e \'import { readText } from "stdio"; await readText();\'', "é", "maxInputBytes"],
    [{ maxSteps: 100 }, 'node -e "while (true) {}"', "", "internal error"],
  ]) {
    const limited = new Shell({ fs }).use(plugin({ runtime, limits }));
    try {
      const result = await limited.exec(command, { stdin });
      equal(result.exitCode, diagnostic ? 124 : 0, "finite SafeJS quota: " + result.stderr);
      if (diagnostic) check(result.stderr.includes(diagnostic), "quota diagnostic " + JSON.stringify(limits) + ": " + result.stderr);
      else equal(result.stdout, "é\n", "exact UTF-8 output boundary");
    } finally { await limited.dispose(); }
  }
  const started = deferred();
  const blocked = deferred();
  const controller = new AbortController();
  const reason = new Error("cancel guest read");
  let returns = 0;
  const cancelled = new Shell({ fs }).use(plugin({ runtime }));
  const task = cancelled.exec('node -e \'import { readText } from "stdio"; import { writeFile } from "fs"; await readText(); await writeFile("/forbidden", "late");\'', {
    signal: controller.signal, stdin: { [Symbol.asyncIterator]() { return {
      next() { started.resolve(); return blocked.promise; },
      async return() { returns++; return { done: true }; },
    }; } },
  }).then(() => { throw new Error("guest cancellation was swallowed"); }, error => { check(error === reason, "guest cancellation identity"); });
  try {
    await started.promise; controller.abort(reason); await task;
    equal(returns, 1, "cancelled guest input closed");
    check(!(await fs.readdir("/")).some(entry => entry.name === "forbidden"), "cancelled guest performed a later write");
  } finally { controller.abort(reason); blocked.resolve({ done: true }); await task; await cancelled.dispose(); }
}

async function verifyLimits(api) {
  let deep = {};
  for (let depth = 0; depth < 1100; depth++) deep = { child: deep };
  const text = "x".repeat(1_000_001);
  const data = { deep, text, entries: Array(100_001).fill(0), aggregate: Array(17).fill(text) };
  const source = "let value = data.deep, depth = 0; while (value.child) { value = value.child; depth++; } return [depth, data.text.length, data.entries.length, data.aggregate.length];";
  const result = await api.run(source, { bindings: { data } });
  equal(result.returnValue, [1100, 1_000_001, 100_001, 17], "unlimited default data budgets");
  const resumed = await api.run(source, { snapshot: result.snapshot });
  equal(resumed.returnValue, result.returnValue, "unlimited snapshot replay");
  for (const options of [{ stringLength: 1_000_000 }, { arrayLength: 100_000 }, { dataSize: 16_000_000 }, { maxCallDepth: 10 }]) {
    let rejected = false;
    try {
      await api.run(options.maxCallDepth ? "function f(n) { return n ? f(n - 1) : 1; } return f(20);" : source,
        { bindings: { data }, budget: new api.Budget(options) });
    }
    catch (error) { rejected = error.code === "budgetExceeded"; }
    check(rejected, "explicit data/call limit ignored: " + JSON.stringify(options));
    if (!options.maxCallDepth) {
      rejected = false;
      try { await api.run(source, { snapshot: result.snapshot, budget: new api.Budget(options) }); }
      catch (error) { rejected = error.code === "budgetExceeded"; }
      check(rejected, "explicit snapshot limit ignored: " + JSON.stringify(options));
    }
  }
}

export async function verifyNetworkAndSafeJs() {
  check(typeof globalThis.process === "undefined", "Worker must run without Node compatibility");
  delete globalThis.Buffer;
  check(typeof globalThis.Buffer === "undefined", "Worker must not supply a global Buffer");
  for (const plugin of [rootNetwork, coreNetwork, networkCommands]) await verifyNetwork(plugin);
  for (const plugin of [rootNode, safeJsCommands, nodeCommands]) await verifyNode(plugin);
  await verifyLimits({ run, Budget });
  return { networkEntries: 3, nodeEntries: 3, safeJsEntries: 1 };
}
