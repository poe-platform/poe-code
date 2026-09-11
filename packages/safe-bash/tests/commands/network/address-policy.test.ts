import assert from "node:assert/strict";
import { test } from "node:test";
import { toByteSource } from "../../../src/contracts/index.js";
import { createOriginAuthorizer } from "../../../src/commands/network/authorizer.js";
import { createFetchTransport } from "../../../src/commands/network/fetch-transport.js";
import { CurlError, type HttpRequest, type HttpResponse, type HttpTransport, type NetworkAuthorization } from "../../../src/commands/network/types.js";
import { run } from "./helpers.js";

function response(status = 200, location?: string): HttpResponse {
  return {
    status, statusText: "", headers: location === undefined ? [] : [["Location", location]],
    body: toByteSource("allowed"), async dispose() {},
  };
}

function resolvedTransport(address: string) {
  const resolved: string[] = [];
  const connected: string[] = [];
  const requirements: (true | undefined)[] = [];
  const literalPolicy = createOriginAuthorizer("*", { denyPrivateNetworks: true });
  const transport: HttpTransport = Object.assign(async (request: HttpRequest) => {
    resolved.push(request.url);
    requirements.push(request.denyPrivateNetworks);
    const destination = new URL(request.url);
    destination.hostname = address.includes(":") ? `[${address}]` : address;
    if (request.denyPrivateNetworks && !await literalPolicy({
      url: destination.href, method: request.method, attempt: 0, signal: request.signal,
    })) throw new CurlError(7, "Private address denied");
    connected.push(address);
    return response();
  }, { supportsPrivateNetworkDeny: true as const });
  return { transport, resolved, connected, requirements };
}

test("private policy announces its requirement without changing boolean authorization", async () => {
  let required = 0;
  const request = {
    url: "https://service.example/", method: "GET", attempt: 0, signal: new AbortController().signal,
    requirePrivateNetworkDeny() { required++; },
  };
  assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: true })(request), true);
  assert.equal(required, 1);
  assert.equal(await createOriginAuthorizer("*", { denyPrivateNetworks: false })(request), true);
  assert.equal(await createOriginAuthorizer("*")(request), true);
  assert.equal(required, 1);
});

for (const initial of [true, false]) {
  test(`private policy snapshots ${initial} rather than retaining mutable options`, async () => {
    const options = { denyPrivateNetworks: initial };
    const authorize = createOriginAuthorizer("*", options);
    options.denyPrivateNetworks = !initial;
    let required = 0;
    const request = {
      url: "http://127.0.0.1/", method: "GET", attempt: 0, signal: new AbortController().signal,
      requirePrivateNetworkDeny() { required++; },
    };
    assert.equal(await authorize(request), !initial);
    assert.equal(required, initial ? 1 : 0);
  });
}

test("unsupported transport fails closed before dispatch or upload consumption", async () => {
  let dispatched = 0;
  let pulled = 0;
  const result = await run(["-T", "-", "http://service.example/"], {
    stdin: (async function* () { pulled++; yield new Uint8Array([1]); })(),
    options: {
      authorize: createOriginAuthorizer("*", { denyPrivateNetworks: true }),
      transport: async request => {
        dispatched++;
        if (request.body) for await (const chunk of request.body) assert.ok(chunk);
        return response();
      },
    },
  });
  assert.equal(result.exitCode, 7);
  assert.equal(dispatched, 0);
  assert.equal(pulled, 0);
});

test("generic fetch is refused even for an allowed hostname", async () => {
  let fetched = 0;
  const result = await run(["http://service.example/"], { options: {
    authorize: createOriginAuthorizer("*", { denyPrivateNetworks: true }),
    transport: createFetchTransport({ fetch: async () => { fetched++; return new Response("unexpected"); } }),
  } });
  assert.equal(result.exitCode, 7);
  assert.equal(fetched, 0);
});

for (const address of ["127.0.0.1", "8.8.8.8"]) {
  test(`wrapped authorization propagates connection policy for ${address}`, async () => {
    const policy = createOriginAuthorizer(["service.example"], { denyPrivateNetworks: true });
    const memory = resolvedTransport(address);
    let authorized = 0;
    const result = await run(["http://service.example/"], { options: {
      authorize: async request => { authorized++; return await policy(request); },
      transport: memory.transport,
    } });
    assert.equal(result.exitCode, address === "127.0.0.1" ? 7 : 0);
    assert.equal(authorized, 1);
    assert.deepEqual(memory.resolved, ["http://service.example/"]);
    assert.deepEqual(memory.requirements, [true]);
    assert.deepEqual(memory.connected, address === "127.0.0.1" ? [] : [address]);
  });
}

test("false authorization performs no resolution or connection", async () => {
  const memory = resolvedTransport("8.8.8.8");
  const result = await run(["http://service.example/"], { options: {
    authorize: request => { request.requirePrivateNetworkDeny?.(); return false; },
    transport: memory.transport,
  } });
  assert.equal(result.exitCode, 7);
  assert.deepEqual(memory.resolved, []);
  assert.deepEqual(memory.connected, []);
});

test("requirements are monotonic within authorization and fresh at each redirect", async () => {
  const strict = createOriginAuthorizer("*", { denyPrivateNetworks: true });
  const permissive = createOriginAuthorizer("*", { denyPrivateNetworks: false });
  const requirements: (true | undefined)[] = [];
  const callbacks: NetworkAuthorization["requirePrivateNetworkDeny"][] = [];
  const literalPolicy = createOriginAuthorizer("*", { denyPrivateNetworks: true });
  const transport: HttpTransport = Object.assign(async (request: HttpRequest) => {
    requirements.push(request.denyPrivateNetworks);
    if (request.denyPrivateNetworks && !await literalPolicy({
      url: "http://8.8.8.8/", method: request.method, attempt: 0, signal: request.signal,
    })) throw new CurlError(7, "Private address denied");
    return requirements.length === 1 ? response(302, "http://next.example/") : response();
  }, { supportsPrivateNetworkDeny: true as const });
  const result = await run(["-L", "http://service.example/"], { options: {
    authorize: async request => {
      callbacks.push(request.requirePrivateNetworkDeny);
      if (request.redirectFrom === undefined) {
        await strict(request);
        request.requirePrivateNetworkDeny?.();
      } else callbacks[0]?.();
      return await permissive(request);
    }, transport,
  } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(requirements, [true, undefined]);
  assert.equal(typeof callbacks[0], "function");
  assert.equal(typeof callbacks[1], "function");
  assert.notEqual(callbacks[0], callbacks[1]);
});

test("retry authorization carries a fresh private-network requirement", async () => {
  const strict = createOriginAuthorizer("*", { denyPrivateNetworks: true });
  const permissive = createOriginAuthorizer("*");
  const memory = resolvedTransport("8.8.8.8");
  const attempts: number[] = [];
  const callbacks: NetworkAuthorization["requirePrivateNetworkDeny"][] = [];
  const transport: HttpTransport = Object.assign(async (request: HttpRequest) => ({
    ...await memory.transport(request), status: memory.resolved.length === 1 ? 503 : 200,
  }), { supportsPrivateNetworkDeny: true as const });
  const result = await run(["--retry", "1", "--retry-delay", "0.001", "http://service.example/"], { options: {
    authorize: request => {
      attempts.push(request.attempt);
      callbacks.push(request.requirePrivateNetworkDeny);
      return request.attempt === 0 ? strict(request) : permissive(request);
    }, transport,
  } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(attempts, [0, 1]);
  assert.deepEqual(memory.requirements, [true, undefined]);
  assert.equal(typeof callbacks[0], "function");
  assert.equal(typeof callbacks[1], "function");
  assert.notEqual(callbacks[0], callbacks[1]);
});

for (const options of [undefined, { denyPrivateNetworks: false }]) {
  test(`omitted or false private policy preserves custom transport access: ${JSON.stringify(options)}`, async () => {
    const requirements: (true | undefined)[] = [];
    const result = await run(["http://127.0.0.1/"], { options: {
      authorize: createOriginAuthorizer("*", options),
      transport: async request => { requirements.push(request.denyPrivateNetworks); return response(); },
    } });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(requirements, [undefined]);
  });
}

test("falsey caller cancellation during authorization retains its identity", async () => {
  const controller = new AbortController();
  const memory = resolvedTransport("8.8.8.8");
  await assert.rejects(run(["http://service.example/"], {
    signal: controller.signal,
    options: {
      authorize: request => { request.requirePrivateNetworkDeny?.(); controller.abort(null); return true; },
      transport: memory.transport,
    },
  }), reason => reason === null);
  assert.deepEqual(memory.resolved, []);
});
