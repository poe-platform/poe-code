import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import http, { type RequestOptions } from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import { createNodeHttpTransport, type NodeHttpTransportOptions } from "../../../src/commands/network/transport.js";
import type { HttpRequest } from "../../../src/commands/network/types.js";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createOriginAuthorizer } from "../../../src/commands/network/authorizer.js";
import { networkCommands } from "../../../src/commands/network/index.js";

type Address = { address: string; family: 4 | 6 };
type SocketRequestOptions = RequestOptions & { autoSelectFamily?: boolean };
type ProtectedRequest = HttpRequest & { denyPrivateNetworks?: true };
type ResolverOptions = NodeHttpTransportOptions & {
  resolveAddress?: (hostname: string, signal: AbortSignal) => Promise<Address>;
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}

function request(overrides: Partial<ProtectedRequest> = {}): ProtectedRequest {
  return { url: "http://public.example:8080/path?query=1", method: "GET", headers: [],
    signal: new AbortController().signal, denyPrivateNetworks: true, ...overrides };
}

function mockRequests(context: TestContext) {
  const calls: { url: URL; options: SocketRequestOptions; writes: Uint8Array[]; destroys: number }[] = [];
  const implementation = (url: URL, options: SocketRequestOptions, receive: (response: unknown) => void) => {
    const call = { url, options, writes: [] as Uint8Array[], destroys: 0 };
    calls.push(call);
    const outgoing = new EventEmitter() as EventEmitter & {
      write: (chunk: Uint8Array, done: () => void) => void;
      end: () => void;
      destroy: (error?: Error) => void;
    };
    outgoing.write = (chunk, done) => { call.writes.push(new Uint8Array(chunk)); done(); };
    outgoing.end = () => queueMicrotask(() => receive({ rawHeaders: [], statusCode: 200,
      statusMessage: "OK", httpVersion: "1.1", destroy() {},
      async *[Symbol.asyncIterator]() { yield new Uint8Array([1]); } }));
    outgoing.destroy = error => {
      call.destroys++;
      queueMicrotask(() => { if (error) outgoing.emit("error", error); outgoing.emit("close"); });
    };
    return outgoing;
  };
  context.mock.method(http, "request", implementation);
  context.mock.method(https, "request", implementation);
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}

function pinnedLookup(options: RequestOptions, all = false): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const lookup = options.lookup as unknown as (
      hostname: string, options: { all: boolean }, callback: (error: Error | null, ...values: unknown[]) => void
    ) => void;
    lookup("public.example", { all }, (error, ...values) => error ? reject(error) : resolve(values));
  });
}

test("Node transport advertises address enforcement", () => {
  assert.equal((createNodeHttpTransport() as { supportsPrivateNetworkDeny?: true }).supportsPrivateNetworkDeny, true);
});

test("protected DNS is resolved once, snapshotted and pinned without changing URL or Host", async context => {
  const calls = mockRequests(context);
  const candidate: Address = { address: "93.184.216.34", family: 4 };
  const resolutions: string[] = [];
  const options: ResolverOptions = { resolveAddress: async hostname => { resolutions.push(hostname); return candidate; } };
  const response = await createNodeHttpTransport(options)(request({ headers: [["Host", "other.example"]] }));
  candidate.address = "127.0.0.1";
  candidate.family = 6;
  assert.deepEqual(resolutions, ["public.example"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.href, "http://public.example:8080/path?query=1");
  assert.deepEqual(calls[0]!.options.headers, { host: "other.example" });
  assert.equal(calls[0]!.options.agent, false);
  assert.equal(calls[0]!.options.family, 4);
  assert.equal(calls[0]!.options.autoSelectFamily, false);
  assert.deepEqual(await pinnedLookup(calls[0]!.options), ["93.184.216.34", 4]);
  assert.deepEqual(await pinnedLookup(calls[0]!.options, true), [[{ address: "93.184.216.34", family: 4 }]]);
  await response.dispose();
});

test("default resolver requests one DNS candidate and pins it", async context => {
  const calls = mockRequests(context);
  const lookups: unknown[][] = [];
  context.mock.method(dns, "lookup", async (...args: unknown[]) => {
    lookups.push(args);
    return { address: "93.184.216.34", family: 4 };
  });
  syncBuiltinESMExports();
  const response = await createNodeHttpTransport()(request());
  assert.deepEqual(lookups, [["public.example", { all: false }]]);
  assert.deepEqual(await pinnedLookup(calls[0]!.options), ["93.184.216.34", 4]);
  await response.dispose();
});

for (const candidate of [
  { address: "127.0.0.1", family: 4 }, { address: "10.1.2.3", family: 4 },
  { address: "::1", family: 6 }, { address: "fc00::1", family: 6 },
  { address: "::ffff:127.0.0.1", family: 6 }, { address: "64:ff9b::192.168.0.1", family: 6 },
  { address: "public.example", family: 4 }, { address: "127.1", family: 4 },
  { address: "93.184.216.34", family: 6 }, { address: "2606:4700::1111", family: 4 },
  { address: "93.184.216.34", family: 0 }, { address: "[2606:4700::1111]", family: 6 },
]) {
  test(`rejects candidate ${candidate.address}/${candidate.family} before request or upload`, async context => {
    const calls = mockRequests(context);
    let uploads = 0;
    const options: ResolverOptions = { resolveAddress: async () => candidate as Address };
    await assert.rejects(createNodeHttpTransport(options)(request({ body: {
      async *[Symbol.asyncIterator]() { uploads++; yield new Uint8Array([1]); },
    } })), error => error instanceof Error);
    assert.equal(calls.length, 0);
    assert.equal(uploads, 0);
  });
}

for (const hostname of ["127.1", "[::1]", "[::ffff:127.0.0.1]", "localhost", "LOCALHOST."]) {
  test(`private literal/name ${hostname} never resolves or constructs`, async context => {
    const calls = mockRequests(context);
    let resolutions = 0;
    const options: ResolverOptions = { resolveAddress: async () => { resolutions++; return { address: "93.184.216.34", family: 4 }; } };
    await assert.rejects(createNodeHttpTransport(options)(request({ url: `http://${hostname}/` })));
    assert.equal(resolutions, 0);
    assert.equal(calls.length, 0);
  });
}

for (const [hostname, address, family] of [
  ["93.184.216.34", "93.184.216.34", 4], ["[2606:4700::1111]", "2606:4700::1111", 6],
] as const) {
  test(`public literal ${hostname} bypasses DNS and keeps its numeric family`, async context => {
    const calls = mockRequests(context);
    const options: ResolverOptions = { resolveAddress: async () => { assert.fail("literal must not resolve"); } };
    const response = await createNodeHttpTransport(options)(request({ url: `http://${hostname}:8080/` }));
    assert.equal(calls[0]!.options.family, family);
    assert.deepEqual(await pinnedLookup(calls[0]!.options), [address, family]);
    await response.dispose();
  });
}

test("unflagged and runtime-false requests preserve legacy DNS admission", async context => {
  const calls = mockRequests(context);
  const options: ResolverOptions = { resolveAddress: async () => { assert.fail("legacy request must not resolve here"); } };
  for (const flag of [undefined, false]) {
    const input = request({ url: "http://127.0.0.1/" });
    const response = await createNodeHttpTransport(options)({ ...input, denyPrivateNetworks: flag } as HttpRequest);
    await response.dispose();
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.lookup, undefined);
    assert.equal(call.options.autoSelectFamily, undefined);
  }
});

for (const reason of [null, false, 0, "", new Error("canceled")]) {
  test(`pre-abort preserves ${String(reason)} with zero acquisition`, async context => {
    const calls = mockRequests(context);
    const controller = new AbortController();
    controller.abort(reason);
    const options: ResolverOptions = { resolveAddress: async () => { assert.fail("pre-aborted DNS"); } };
    await assert.rejects(createNodeHttpTransport(options)(request({ signal: controller.signal })), error => error === reason);
    assert.equal(calls.length, 0);
  });
}

test("immediate registered disposal closes admission before resolver", async context => {
  const calls = mockRequests(context);
  let cleanup: Promise<void> | undefined;
  let resolutions = 0;
  const options: ResolverOptions = { resolveAddress: async () => { resolutions++; return { address: "93.184.216.34", family: 4 }; } };
  await assert.rejects(createNodeHttpTransport(options)(request({ registerCleanup: dispose => { cleanup = Promise.resolve(dispose()); } })));
  await cleanup;
  assert.equal(resolutions, 0);
  assert.equal(calls.length, 0);
});

test("abort between scheduling and resolver admission performs no DNS", async context => {
  const calls = mockRequests(context);
  const controller = new AbortController();
  const reason = false;
  let resolutions = 0;
  const options: ResolverOptions = { resolveAddress: async () => { resolutions++; return { address: "93.184.216.34", family: 4 }; } };
  await assert.rejects(createNodeHttpTransport(options)(request({ signal: controller.signal,
    registerCleanup: () => { queueMicrotask(() => controller.abort(reason)); },
  })), error => error === reason);
  assert.equal(resolutions, 0);
  assert.equal(calls.length, 0);
});

for (const completion of ["resolve", "reject"] as const) {
  test(`cancellation settles without waiting for opaque DNS and observes late ${completion}`, async context => {
    const calls = mockRequests(context);
    const controller = new AbortController();
    const entered = deferred<void>();
    const candidate = deferred<Address>();
    let cleanup: (() => Promise<void>) | undefined;
    let uploads = 0;
    const options: ResolverOptions = { resolveAddress: async (_hostname, signal) => {
      assert.ok(cleanup);
      assert.equal(signal.aborted, false);
      entered.resolve();
      return candidate.promise;
    } };
    const pending = createNodeHttpTransport(options)(request({ signal: controller.signal,
      registerCleanup: dispose => { cleanup = () => Promise.resolve(dispose()); },
      body: { async *[Symbol.asyncIterator]() { uploads++; yield new Uint8Array([1]); } },
    }));
    await Promise.race([entered.promise, pending.then(() => { assert.fail("DNS admission was bypassed"); })]);
    const rejected = assert.rejects(pending, error => error === null);
    controller.abort(null);
    await rejected;
    await cleanup!();
    if (completion === "resolve") candidate.resolve({ address: "93.184.216.34", family: 4 });
    else candidate.reject(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(calls.length, 0);
    assert.equal(uploads, 0);
  });
}

test("resolver completion cannot acquire after abort", async context => {
  const calls = mockRequests(context);
  const controller = new AbortController();
  const options: ResolverOptions = { resolveAddress: async () => {
    controller.abort(0);
    return { address: "93.184.216.34", family: 4 };
  } };
  await assert.rejects(createNodeHttpTransport(options)(request({ signal: controller.signal })), error => error === 0);
  assert.equal(calls.length, 0);
});

test("each concurrent request retains its own pinned candidate", async context => {
  const calls = mockRequests(context);
  const first = deferred<Address>();
  const second = deferred<Address>();
  const transport = createNodeHttpTransport({ resolveAddress: hostname => hostname === "first.example" ? first.promise : second.promise });
  const pendingFirst = transport(request({ url: "http://first.example/" }));
  const pendingSecond = transport(request({ url: "http://second.example/" }));
  second.resolve({ address: "2606:4700::1111", family: 6 });
  const responseSecond = await pendingSecond;
  first.resolve({ address: "93.184.216.34", family: 4 });
  const responseFirst = await pendingFirst;
  assert.deepEqual(await pinnedLookup(calls[0]!.options), ["2606:4700::1111", 6]);
  assert.deepEqual(await pinnedLookup(calls[1]!.options), ["93.184.216.34", 4]);
  await Promise.all([responseFirst.dispose(), responseSecond.dispose()]);
});

test("candidate getters are snapshotted once and cancellation still prevents request admission", async context => {
  const calls = mockRequests(context);
  const controller = new AbortController();
  let reads = 0;
  const transport = createNodeHttpTransport({ resolveAddress: async () => ({
    get address() { reads++; controller.abort(false); return "93.184.216.34"; }, family: 4,
  }) });
  await assert.rejects(transport(request({ signal: controller.signal })), error => error === false);
  assert.equal(reads, 1);
  assert.equal(calls.length, 0);
});

for (const reason of [null, false, 0, ""]) {
  test(`resolver failure preserves ${String(reason)} and closes cooperative cleanup`, async context => {
    const calls = mockRequests(context);
    let cleanup: (() => Promise<void>) | undefined;
    const transport = createNodeHttpTransport({ resolveAddress: async () => { throw reason; } });
    await assert.rejects(transport(request({ registerCleanup: dispose => { cleanup = () => Promise.resolve(dispose()); } })), error => error === reason);
    await cleanup!();
    assert.equal(calls.length, 0);
  });
}

test("cleanup during unresolved DNS settles admission and ignores late successful acquisition", async context => {
  const calls = mockRequests(context);
  const entered = deferred<void>();
  const candidate = deferred<Address>();
  let cleanup!: () => Promise<void>;
  const transport = createNodeHttpTransport({ resolveAddress: async () => { entered.resolve(); return candidate.promise; } });
  const pending = transport(request({ registerCleanup: dispose => { cleanup = () => Promise.resolve(dispose()); } }));
  await entered.promise;
  const rejected = assert.rejects(pending, error => error instanceof DOMException && error.name === "AbortError");
  await Promise.all([cleanup(), cleanup()]);
  await rejected;
  candidate.resolve({ address: "93.184.216.34", family: 4 });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test("Shell existing private-network option reaches actual Node transport and denies resolved private upload", async context => {
  const calls = mockRequests(context);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/payload", new Uint8Array([1, 2, 3]));
  const resolutions: string[] = [];
  const transport = createNodeHttpTransport({ resolveAddress: async hostname => {
    resolutions.push(hostname);
    return { address: "127.0.0.1", family: 4 };
  } });
  const shell = new Shell({ fs }).use(networkCommands({ transport,
    authorize: createOriginAuthorizer("*", { denyPrivateNetworks: true }),
  }));
  try {
    const result = await shell.exec("curl --data-binary @/payload http://public.example/");
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Private network destination denied/u);
    assert.deepEqual(resolutions, ["public.example"]);
    assert.equal(calls.length, 0);
  } finally { await shell.dispose(); }
});

test("Shell existing private-network option reaches actual Node transport and pins public upload", async context => {
  const calls = mockRequests(context);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/payload", new Uint8Array([1, 2, 3]));
  const transport = createNodeHttpTransport({ resolveAddress: async () => ({ address: "93.184.216.34", family: 4 }) });
  const shell = new Shell({ fs }).use(networkCommands({ transport,
    authorize: createOriginAuthorizer("*", { denyPrivateNetworks: true }),
  }));
  try {
    const result = await shell.exec("curl --data-binary @/payload http://public.example/");
    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.writes, [new Uint8Array([1, 2, 3])]);
    assert.deepEqual(await pinnedLookup(calls[0]!.options), ["93.184.216.34", 4]);
  } finally { await shell.dispose(); }
});
