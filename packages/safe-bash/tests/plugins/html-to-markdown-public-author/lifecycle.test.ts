import assert from "node:assert/strict";
import { setImmediate as turn } from "node:timers/promises";
import test from "node:test";
import { Shell, FsError, agentCommands, createAgentCommands, createMemoryFileSystem, createHtmlToMarkdownCommand, htmlToMarkdownCommands, networkCommands, type ByteSource, type HttpRequest } from "../../../src/index.js";
import { byteChunks, convert } from "../../commands/html-to-markdown/helpers.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function deadline<Value>(promise: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("author observation deadline exceeded")), 3000); })]); }
  finally { clearTimeout(timer); }
}

test("HTML operation uses the accounted stdout path once", async () => {
  const closed = new AbortController(); let ordinary = 0, accounted = 0;
  const chunks: Uint8Array[] = [];
  const result = await convert("<h1>Once</h1>", {}, { stdout: {
    async write() { ordinary++; },
    ownedOutput: { consumerClosed: closed.signal, async write(bytes) { accounted++; chunks.push(new Uint8Array(bytes)); } },
  } });
  assert.equal(result.exitCode, 0); assert.equal(ordinary, 0); assert.equal(accounted, 1);
  assert.equal(Buffer.concat(chunks).toString(), "# Once\n");
});

test("invalid arguments still report on caller stderr after stdout closure", async () => {
  const caller = new AbortController(), closed = new AbortController(); closed.abort(new FsError("EPIPE"));
  let acquired = 0;
  const result = await convert({ [Symbol.asyncIterator]() { acquired++; throw new Error("unexpected acquisition"); } }, {}, {
    args: ["--invalid"], signal: caller.signal,
    stdout: { async write() { throw new Error("unexpected output"); }, ownedOutput: { consumerClosed: closed.signal, async write() { throw new Error("unexpected output"); } } },
  });
  assert.equal(result.exitCode, 2); assert.match(result.stderr, /^html-to-markdown: /u); assert.equal(acquired, 0); assert.equal(caller.signal.aborted, false);
});

for (const headers of [false, true]) test(`cooperative curl input closes before HTML's first write; required headers=${headers}`, async () => {
  const started = deferred<void>(); const caller = new AbortController();
  let request: HttpRequest | undefined, reads = 0, returns = 0, disposed = 0, active = 0;
  const authorized: string[] = [];
  const fs = createMemoryFileSystem(); const shell = new Shell({ fs }).use(agentCommands()).use(networkCommands({
    authorize: context => { authorized.push(context.url); return context.url === "https://page.test/document"; },
    transport: async incoming => {
      request = incoming;
      const pending = deferred<IteratorResult<Uint8Array>>();
      incoming.signal.addEventListener("abort", () => pending.resolve({ done: true, value: undefined }), { once: true });
      return { status: 200, statusText: "OK", headers: [["content-type", "text/html"]], body: { [Symbol.asyncIterator]() { return {
        async next() { reads++; active++; started.resolve(); try { return await pending.promise; } finally { active--; } },
        async return() { returns++; pending.resolve({ done: true, value: undefined }); return { done: true, value: undefined }; },
      }; } }, async dispose() { disposed++; pending.resolve({ done: true, value: undefined }); } };
    },
  }));
  const head = createAgentCommands().find(command => command.name === "head")!;
  await shell.exec(":");
  shell.register({ name: "head", async execute(context) { await started.promise; return head.execute(context); } }, { replace: true });
  try {
    const result = await deadline(shell.exec(`curl ${headers ? "-D /headers " : ""}https://page.test/document | html-to-markdown | head -n 0`, { signal: caller.signal }));
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
    assert.deepEqual(authorized, ["https://page.test/document"]); assert.equal(reads, 1); assert.equal(active, 0);
    assert.equal(returns, 1); assert.equal(disposed, 1); assert.equal(request?.signal.aborted, !headers); assert.equal(caller.signal.aborted, false);
    if (headers) assert.match(Buffer.from(await fs.readFile("/headers")).toString(), /content-type: text\/html/iu);
  } finally { caller.abort(new Error("author fixture cleanup")); await shell.dispose(); }
});

test("fake-authorized curl to HTML conversion and required redirected output", async () => {
  const fs = createMemoryFileSystem(), caller = new AbortController(); let disposed = 0;
  const shell = new Shell({ fs }).use(agentCommands()).use(networkCommands({
    authorize: context => context.url === "https://page.test/document",
    transport: async () => ({ status: 200, statusText: "OK", headers: [], body: byteChunks("<h1>Keep</h1><p>body</p>"), async dispose() { disposed++; } }),
  }));
  try {
    const result = await deadline(shell.exec("curl https://page.test/document | html-to-markdown > /doc.md | head -n 0", { signal: caller.signal }));
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/doc.md")).toString(), "# Keep\n\nbody\n");
    assert.equal(disposed, 1); assert.equal(caller.signal.aborted, false);
  } finally { caller.abort(new Error("author fixture cleanup")); await shell.dispose(); }
});

test("registered cleanup precedes input acquisition and limit errors preserve caller stderr", async () => {
  let registered = 0, returned = 0, reads = 0;
  const cleanup: (() => void | Promise<void>)[] = [];
  const caller = new AbortController();
  const source: ByteSource = { [Symbol.asyncIterator]() {
    assert.ok(registered > 0);
    return { async next() { reads++; return { done: false, value: Buffer.from("<p>large</p>") }; }, async return() { returned++; return { done: true, value: undefined }; } };
  } };
  const result = await convert(source, { limits: { maxInputBytes: 4 } }, { signal: caller.signal, registerCleanup: callback => { registered++; cleanup.push(callback); } });
  try {
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /html-to-markdown: .*input limit exceeded/u);
    assert.equal(result.stdout, ""); assert.equal(reads, 1); assert.equal(returned, 1); assert.equal(caller.signal.aborted, false);
  } finally { for (const callback of cleanup) await callback(); }
});

test("caller reason identity and acquired input finalization survive operation routing", async () => {
  const caller = new AbortController(), started = deferred<void>(), pending = deferred<IteratorResult<Uint8Array>>(); let returned = 0;
  const reason = Object.freeze({ reason: "caller identity" });
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { started.resolve(); return pending.promise; },
    async return() { returned++; pending.resolve({ done: true, value: undefined }); return { done: true, value: undefined }; },
  }; } };
  const execution = convert(source, {}, { signal: caller.signal });
  await started.promise; caller.abort(reason);
  await assert.rejects(deadline(execution), error => error === reason); assert.equal(returned, 1);
});

test("opaque input finalization is awaited, never claimed preempted", async () => {
  const caller = new AbortController(), closed = new AbortController(), started = deferred<void>(), release = deferred<void>();
  let returned = 0, settled = false;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { started.resolve(); await release.promise; return { done: true, value: undefined }; },
    async return() { returned++; await release.promise; return { done: true, value: undefined }; },
  }; } };
  const reason = new FsError("EPIPE");
  const execution = convert(source, {}, { signal: caller.signal, stdout: { async write() {}, ownedOutput: { consumerClosed: closed.signal, async write() {} } } });
  const observed = execution.then(() => { settled = true; }, error => { settled = true; throw error; });
  void observed.catch(() => {});
  await started.promise; closed.abort(reason); await turn();
  assert.equal(settled, false); assert.equal(caller.signal.aborted, false);
  release.resolve(); await assert.rejects(deadline(observed), error => error === reason); assert.equal(returned, 1);
});

test("standalone plugin and aggregate preserve limits, collision preflight and replacement", async () => {
  const fs = createMemoryFileSystem(); const shell = new Shell({ fs }).use(htmlToMarkdownCommands());
  try {
    shell.use(agentCommands());
    await assert.rejects(shell.exec(":"), /already registered/u);
    assert.equal(shell.commands.has("echo"), false);
  } finally { await shell.dispose(); }
  const replacing = new Shell({ fs }).use(htmlToMarkdownCommands()).use(agentCommands({ replace: true, htmlToMarkdown: { limits: { maxInputBytes: 4 } } }));
  try {
    const result = await replacing.exec("html-to-markdown", { stdin: "too long" });
    assert.equal(result.exitCode, 1); assert.match(result.stderr, /input limit exceeded/u);
    assert.equal(replacing.commands.has("curl"), false); assert.equal(replacing.commands.has("safejs"), false);
    assert.equal(replacing.commands.has("du"), true); assert.equal(replacing.commands.has("expr"), true);
    assert.equal(createHtmlToMarkdownCommand().name, "html-to-markdown");
  } finally { await replacing.dispose(); }
});
