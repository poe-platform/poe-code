import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  collectBytes, FsError, toByteSource, type ByteSource,
} from "../../../../src/contracts/index.js";
import {
  createCurlCommand, createNodeHttpTransport,
  type HttpHeaders, type HttpRequest, type HttpResponse,
} from "../../../../src/commands/network/index.js";
import { bytes, deferred, discard, fixture, remainsPending, turn } from "./helpers.js";

const url = "http://owned.invalid/start";
const response = (body: ByteSource = toByteSource("body"), dispose: () => Promise<void> = async () => {}): HttpResponse => ({
  status: 200, statusText: "OK", headers: [], body, dispose,
});

test("an explicitly enrolled direct curl sink does not return its borrowed stdin cursor", async () => {
  const { shell, fs } = fixture();
  const consumer = new AbortController();
  let returned = false;
  const source = (async function* () {
    try { yield bytes("sent"); yield bytes("retained"); }
    finally { returned = true; }
  })();
  const command = createCurlCommand({ authorize: () => true, async transport(request) {
    for await (const chunk of request.body!) {
      assert.deepEqual(chunk, bytes("sent"));
      consumer.abort(new FsError("EPIPE"));
    }
    return response();
  } });
  const result = await command.execute({ command: "curl", args: ["-T", "-", url], cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: source, stderr: discard,
    stdout: { ...discard, ownedOutput: { ...discard, consumerClosed: consumer.signal } },
  });
  assert.equal(result.exitCode, 141);
  assert.equal(returned, false);
  assert.deepEqual((await source.next()).value, bytes("retained"));
  await source.return();
  assert.equal(returned, true);
  await shell.dispose();
});

test("real Shell curl streams stdin without prebuffer and preserves the next borrowed chunk", async () => {
  const { shell, commands } = fixture();
  let reads = 0;
  let returns = 0;
  let disposed = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      reads++;
      return reads <= 2 ? { done: false, value: bytes(reads === 1 ? "sent" : "retained") } : { done: true, value: undefined };
    },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  commands.register(createCurlCommand({
    authorize() { assert.equal(reads, 0); return true; },
    async transport(request) {
      assert.equal(reads, 0);
      assert.equal(typeof request.registerCleanup, "function");
      const iterator = request.body![Symbol.asyncIterator]();
      assert.deepEqual((await iterator.next()).value, bytes("sent"));
      assert.equal(reads, 1);
      return response(toByteSource("reply:"), async () => {
        disposed++; await iterator.return?.(); assert.equal(reads, 1); assert.equal(returns, 0);
      });
    },
  }));
  const result = await shell.exec(`curl -T - ${url}; cat`, { stdin: source });
  assert.equal(result.stdout, "reply:retained");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(disposed, 1);
  assert.equal(returns, 0);
  await shell.dispose();
});

for (const status of [200, 302, 429, 503]) {
  for (const upload of ["stdin", "file"]) {
    test(`zero CLI caps cannot replay: status=${status}, upload=${upload}, stdout closes`, { timeout: 2500 }, async () => {
      const { shell, commands, fs } = fixture({ limits: { pipeHighWaterMark: 1 } });
      const payload = bytes("upload");
      await fs.writeFile("/upload", payload);
      const entered = deferred();
      const cleaning = deferred();
      const release = deferred();
      const requests: HttpRequest[] = [];
      const authorizations: number[] = [];
      const uploaded: Uint8Array[] = [];
      const statuses: number[] = [];
      let disposals = 0;
      let cleaned = false;
      const headers: HttpHeaders = status === 302 ? [["Location", "/redirect"]] : [["Retry-After", "3600"]];
      commands.register(createCurlCommand({
        limits: { maxRedirects: 0, maxRetries: 0 },
        authorize(request) { authorizations.push(request.attempt); return true; },
        async transport(request) {
          requests.push(request);
          uploaded.push(await collectBytes(request.body!, { maxBytes: 1024, signal: request.signal }));
          entered.resolve();
          return { ...response(), status, headers, async dispose() {
            disposals++; cleaning.resolve(); await release.promise; cleaned = true;
          } };
        },
      }));
      commands.register({ name: "close-first", async execute() { await entered.promise; return { exitCode: 0 }; } });
      shell.use(async (context, next) => {
        const result = await next();
        if (context.command === "curl") statuses.push(result.exitCode);
        return result;
      });
      const execution = shell.exec(`curl -T ${upload === "stdin" ? "-" : "/upload"} -L --max-redirs 99 --retry 99 -m 0.4 -D /headers -o /body -w '%{http_code}' ${url} | close-first`, { stdin: payload });
      await cleaning.promise;
      await remainsPending(execution);
      assert.equal(new TextDecoder().decode(await fs.readFile("/headers")).includes(` ${status} `), true);
      if (status === 302) await assert.rejects(fs.stat("/body"), error => error instanceof FsError && error.code === "ENOENT");
      else assert.deepEqual(await fs.readFile("/body"), bytes("body"));
      release.resolve();
      const result = await execution;
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, status === 302 ? "curl: (47) Maximum redirects exceeded\n" : "");
      assert.deepEqual(statuses, [status === 302 ? 47 : 141]);
      assert.deepEqual(requests.map(request => request.url), [url]);
      assert.deepEqual(authorizations, [0]);
      assert.deepEqual(uploaded, [payload]);
      assert.equal(disposals, 1);
      assert.equal(cleaned, true);
      await shell.dispose();
    });
  }
}

for (const output of ["body-file", "header-file"] as const) {
  test(`stdout-only closure preserves required ${output} and stderr`, { timeout: 2500 }, async () => {
    const { shell, commands, fs } = fixture({ limits: { pipeHighWaterMark: 1 } });
    const entered = deferred();
    let disposed = false;
    let commandSignal!: AbortSignal;
    commands.register(createCurlCommand({ authorize: () => true, async transport() {
      entered.resolve();
      return { ...response(toByteSource("body"), async () => { await turn(); disposed = true; }), status: 503, headers: [["X-Required", "yes"]] };
    } }));
    commands.register({ name: "close-first", async execute() { await entered.promise; return { exitCode: 0 }; } });
    shell.use(async (context, next) => { if (context.command === "curl") commandSignal = context.signal; return next(); });
    const flags = output === "body-file" ? "-D - -o /body" : "-D /headers";
    const result = await shell.exec(`curl --fail-with-body ${flags} ${url} | close-first`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "curl: (22) HTTP response status 503\n");
    if (output === "body-file") assert.deepEqual(await fs.readFile("/body"), bytes("body"));
    else assert.equal(new TextDecoder().decode(await fs.readFile("/headers")).includes("X-Required: yes"), true);
    assert.equal(commandSignal.aborted, false);
    assert.equal(disposed, true);
    await shell.dispose();
  });
}

for (const rejects of [false, true]) {
  test(`stdout cancellation drains pending cooperative transport acquisition: rejects=${rejects}`, { timeout: 2500 }, async () => {
    const { shell, commands } = fixture();
    const entered = deferred();
    const closing = deferred();
    const gate = deferred<HttpResponse>();
    const release = deferred();
    let transportCleanup = false;
    let disposals = 0;
    commands.register(createCurlCommand({ authorize: () => true, async transport(request) {
      request.registerCleanup!(async () => { closing.resolve(); await release.promise; transportCleanup = true; });
      entered.resolve();
      return gate.promise;
    } }));
    commands.register({ name: "close-first", async execute() { await entered.promise; return { exitCode: 0 }; } });
    const execution = shell.exec(`curl ${url} | close-first`);
    await closing.promise;
    await remainsPending(execution);
    if (rejects) gate.reject(new Error("late transport rejection"));
    else gate.resolve(response(toByteSource(""), async () => { disposals++; }));
    await remainsPending(execution);
    release.resolve();
    const result = await execution;
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(disposals, rejects ? 0 : 1);
    assert.equal(transportCleanup, true);
    await shell.dispose();
  });
}

test("curl byte streaming owns reused download chunks across pipe and file output", async () => {
  const { shell, commands, fs } = fixture();
  commands.register(createCurlCommand({ authorize: () => true, async transport() {
    return response((async function* () {
      const chunk = Buffer.from([0, 255]);
      yield chunk; chunk[0] = 128; yield chunk; chunk.fill(42);
    })());
  } }));
  const expected = Uint8Array.from([0, 255, 128, 255]);
  assert.deepEqual((await shell.exec(`curl ${url} | cat`)).stdoutBytes, expected);
  assert.equal((await shell.exec(`curl -o /bytes ${url}`)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/bytes"), expected);
  await shell.dispose();
});

test("real Node transport registers before acquisition and drains request close on early body closure", { timeout: 3000 }, async context => {
  const { shell, commands } = fixture({ limits: { pipeHighWaterMark: 1 } });
  let registrations = 0;
  let cleanupDone = 0;
  let requests = 0;
  const peerClosed = deferred();
  const server = createServer((_request, reply) => {
    requests++;
    assert.equal(registrations, 1);
    reply.writeHead(200, { "Content-Type": "text/plain" });
    reply.write("first\n");
    reply.on("close", () => peerClosed.resolve());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => { await shell.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/`;
  const transport = createNodeHttpTransport();
  const refused = new Error("closed admission");
  await assert.rejects(transport({ url: endpoint, method: "GET", headers: [], signal: new AbortController().signal, registerCleanup() { throw refused; } }), error => error === refused);
  await turn();
  assert.equal(requests, 0);
  commands.register(createCurlCommand({ authorize: request => request.url === endpoint, transport: request => transport({
    ...request, registerCleanup(cleanup) {
      registrations++;
      request.registerCleanup!(async () => { await cleanup(); cleanupDone++; });
    },
  }) }));
  const result = await shell.exec(`curl ${endpoint} | head -n 1`);
  assert.equal(result.stdout, "first\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(requests, 1);
  assert.equal(cleanupDone, 1);
  await peerClosed.promise;
});
