import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const reference = await tsImport(
  "../../mcp-oauth/src/client/default-oauth-client-provider.ts",
  import.meta.url
);
const resource = "https://resource.example/mcp",
  issuer = "https://auth.example";
function discovery(server = issuer) {
  return {
    resource,
    resourceMetadataUrl: resource + "/metadata",
    resourceMetadata: { resource, authorization_servers: [server] },
    authorizationServer: server,
    authorizationServerMetadataUrl: server + "/metadata",
    authorizationServerMetadata: {
      issuer: server,
      authorization_endpoint: server + "/authorize",
      token_endpoint: server + "/token",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"]
    }
  };
}
function session(
  tokens = { accessToken: " token ", tokenType: "Bearer", expiresAt: null },
  server = issuer
) {
  const d = discovery(server);
  return {
    resource,
    authorizationServer: server,
    client: { clientId: " client ", clientSecret: " secret " },
    discovery: {
      resourceMetadataUrl: d.resourceMetadataUrl,
      resourceMetadata: d.resourceMetadata,
      authorizationServerMetadata: d.authorizationServerMetadata
    },
    tokens
  };
}
function storage(initial = null) {
  let value = structuredClone(initial);
  const calls = [];
  return {
    calls,
    async load(key) {
      calls.push(["load", key]);
      return structuredClone(value);
    },
    async save(key, next) {
      calls.push(["save", key, structuredClone(next)]);
      value = structuredClone(next);
    },
    async clear(key) {
      calls.push(["clear", key]);
      value = null;
    },
    value: () => structuredClone(value)
  };
}
class Server extends EventEmitter {
  listen(port, host, done) {
    queueMicrotask(done);
  }
  address() {
    return { port: 12345 };
  }
  closeAllConnections() {}
  close() {
    this.closed = (this.closed ?? 0) + 1;
  }
  request(url) {
    let status, body;
    this.emit(
      "request",
      { url },
      {
        writeHead(code) {
          status = code;
        },
        end(value) {
          body = value;
        }
      }
    );
    return { status, body };
  }
}
const summarize = (result) =>
  result?.error
    ? { action: result.action, error: result.error.message, name: result.error.name }
    : result;
async function run(
  factory,
  initial,
  responses = [{ access_token: "new", token_type: "Bearer", expires_in: 2 }],
  mode = "request",
  custom = {}
) {
  const store = storage(initial);
  let clocks = 0,
    browsers = 0;
  const calls = [];
  const provider = factory.createDefaultOAuthClientProvider({
    client: { mode: "static", clientId: "configured" },
    browser: {
      openBrowser: async () => {
        browsers++;
        throw new Error("consent required");
      }
    },
    sessionStore: store,
    now: () => {
      clocks++;
      return 1000;
    },
    ...custom
  });
  const fetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      body: init.body,
      redirect: init.redirect,
      signal: !!init.signal
    });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body ?? next), { status: next.status ?? 200 });
  };
  const headers = new Headers();
  let result;
  try {
    result =
      mode === "request"
        ? await provider.authorizeRequest({ requestUrl: new URL(resource), headers, fetch })
        : await provider.handleUnauthorized({
            requestUrl: new URL(resource),
            response: new Response(null, { status: 401 }),
            challenge: mode === "invalid" ? { params: { error: "invalid_token" } } : null,
            discovery: discovery(),
            fetch
          });
  } catch (error) {
    result = { action: "threw", error };
  }
  return {
    result: summarize(result),
    headers: [...headers],
    calls,
    store: store.calls,
    value: store.value(),
    clocks,
    browsers
  };
}
test("provider factory returns only an own supplied provider", () => {
  const provider = { handleUnauthorized: async () => ({ action: "fail" }) };
  assert.equal(own.createOAuthClientProvider({ provider }), provider);
});
test("noninteractive cached/invalid/expired sessions and refresh requests match the oracle", async () => {
  const candidates = [
    null,
    session(),
    session(undefined),
    session({ accessToken: "t", tokenType: "Bearer", expiresAt: 0 }),
    session({ accessToken: "t", tokenType: "Bearer", expiresAt: 3000 }),
    session({ accessToken: "t", tokenType: "Bearer", expiresAt: 0, refreshToken: " r " }),
    { ...session(), client: { clientId: " " } },
    session({ accessToken: "t", tokenType: "bearer", expiresAt: null }),
    session({ accessToken: "t", tokenType: "Bearer", expiresAt: NaN }),
    session({ accessToken: "t", tokenType: "Bearer", expiresAt: null, refreshToken: " " })
  ];
  for (const initial of candidates)
    assert.deepEqual(await run(own, initial), await run(reference, initial));
});
test("refresh terminal/transient errors and forced invalid-token refresh match", async () => {
  const initial = session({
    accessToken: "t",
    tokenType: "Bearer",
    expiresAt: 0,
    refreshToken: "r"
  });
  for (const error of [
    "invalid_grant",
    "invalid_client",
    "server_error",
    "temporarily_unavailable",
    "invalid_request"
  ])
    for (const status of [400, 503]) {
      const responses = [
        { body: { error, error_description: "failure" }, status },
        { access_token: "new", token_type: "Bearer", expires_in: 2 }
      ];
      assert.deepEqual(
        await run(own, initial, responses),
        await run(reference, initial, responses)
      );
    }
  const valid = session({
    accessToken: "t",
    tokenType: "Bearer",
    expiresAt: 3000,
    refreshToken: "r"
  });
  assert.deepEqual(
    await run(own, valid, undefined, "invalid"),
    await run(reference, valid, undefined, "invalid")
  );
});
test("interactive static and dynamic registration flows preserve parameters and cleanup", async () => {
  for (const mode of ["static", "dynamic"]) {
    let expected;
    for (const factory of [reference, own]) {
      const store = storage(),
        servers = [],
        calls = [],
        opened = [];
      let challenge;
      const provider = factory.createDefaultOAuthClientProvider({
        client: {
          mode,
          clientId: mode === "static" ? " client " : undefined,
          metadata: {
            clientName: " App ",
            scope: " read write ",
            softwareId: " id ",
            softwareVersion: " v1 "
          }
        },
        sessionStore: store,
        now: () => 1000,
        browser: {
          createServer: () => {
            const server = new Server();
            servers.push(server);
            return server;
          },
          openBrowser: async (value) => {
            const url = new URL(value);
            challenge = url.searchParams.get("code_challenge");
            const params = Object.fromEntries(url.searchParams);
            const state = JSON.parse(Buffer.from(params.state, "base64url").toString());
            opened.push({
              ...params,
              state: { v: state.v, n: !!state.n, i: state.i, r: state.r },
              code_challenge: !!challenge
            });
            servers
              .at(-1)
              .request(
                "/callback?code=code&state=" +
                  encodeURIComponent(params.state) +
                  "&iss=" +
                  encodeURIComponent(issuer)
              );
          }
        }
      });
      const d = discovery();
      d.authorizationServerMetadata.registration_endpoint = issuer + "/register";
      d.authorizationServerMetadata.authorization_response_iss_parameter_supported = true;
      const fetch = async (url, init) => {
        if (String(url).endsWith("/register")) {
          calls.push({
            url,
            body: JSON.parse(init.body),
            redirect: init.redirect,
            signal: !!init.signal
          });
          return Response.json({ client_id: " dynamic ", client_secret: " secret " });
        }
        const params = Object.fromEntries(new URLSearchParams(init.body));
        assert.equal(
          createHash("sha256").update(params.code_verifier).digest("base64url"),
          challenge
        );
        params.code_verifier = !!params.code_verifier;
        calls.push({ url, body: params, redirect: init.redirect, signal: !!init.signal });
        return Response.json({ access_token: "access", token_type: "Bearer", expires_in: 2 });
      };
      const result = await provider.handleUnauthorized({
        requestUrl: new URL(resource),
        response: new Response(null, { status: 401 }),
        challenge: null,
        discovery: d,
        fetch
      });
      const observed = {
        result: summarize(result),
        calls,
        opened,
        store: store.calls,
        value: store.value(),
        closed: servers.map((server) => server.closed)
      };
      if (factory === reference) expected = observed;
      else assert.deepEqual(observed, expected);
    }
  }
});
test("issuer changes, request binding and unsafe endpoints reject before credentials or browsers", async () => {
  for (const server of [
    "http://127.attacker.example",
    "http://127.0.0.1.attacker.example",
    "http://[::1]",
    "http://localhost.",
    "https://auth.example"
  ]) {
    let expected;
    for (const factory of [reference, own]) {
      let browser = 0,
        fetches = 0;
      const store = storage(session(undefined, "https://old.example"));
      const provider = factory.createDefaultOAuthClientProvider({
        client: { mode: "static", clientId: "client" },
        sessionStore: store,
        now: () => 1000,
        browser: {
          createServer: () => new Server(),
          openBrowser: async () => {
            browser++;
            throw new Error("consent required");
          }
        }
      });
      const result = await provider.handleUnauthorized({
        requestUrl: new URL(resource),
        response: new Response(null, { status: 401 }),
        challenge: null,
        discovery: discovery(server),
        fetch: async () => {
          fetches++;
          throw new Error("must not fetch");
        }
      });
      const observed = { result: summarize(result), browser, fetches, calls: store.calls };
      if (factory === reference) expected = observed;
      else assert.deepEqual(observed, expected);
    }
  }
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("concurrent refreshes share one fetch and preserve clock/store behavior", async () => {
  let baseline;
  for (const factory of [reference, own]) {
    const initial = session({
      accessToken: "old",
      tokenType: "Bearer",
      expiresAt: 0,
      refreshToken: "refresh"
    });
    const store = storage(initial),
      entered = deferred(),
      release = deferred();
    let fetches = 0,
      clocks = 0;
    const provider = factory.createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" },
      browser: { openBrowser: async () => {} },
      sessionStore: store,
      now: () => {
        clocks++;
        return 1000;
      }
    });
    const fetch = async () => {
      fetches++;
      entered.resolve();
      await release.promise;
      return Response.json({ access_token: "new", token_type: "Bearer", expires_in: 2 });
    };
    const a = new Headers(),
      b = new Headers();
    const first = provider.authorizeRequest({ requestUrl: new URL(resource), headers: a, fetch });
    await entered.promise;
    const second = provider.authorizeRequest({ requestUrl: new URL(resource), headers: b, fetch });
    await Promise.resolve();
    await Promise.resolve();
    release.resolve();
    await Promise.all([first, second]);
    const observed = {
      fetches,
      clocks,
      headers: [[...a], [...b]],
      calls: store.calls,
      value: store.value()
    };
    if (factory === reference) baseline = observed;
    else assert.deepEqual(observed, baseline);
  }
});
test("concurrent unauthorized requests share one browser/token exchange and dispose the callback", async () => {
  let baseline;
  for (const factory of [reference, own]) {
    const store = storage(),
      entered = deferred(),
      release = deferred();
    let browsers = 0,
      fetches = 0;
    const servers = [];
    const provider = factory.createDefaultOAuthClientProvider({
      client: { mode: "static", clientId: "client" },
      sessionStore: store,
      browser: {
        createServer: () => {
          const server = new Server();
          servers.push(server);
          return server;
        },
        openBrowser: async (value) => {
          browsers++;
          entered.resolve();
          await release.promise;
          const url = new URL(value);
          servers
            .at(-1)
            .request(
              "/callback?code=code&state=" + encodeURIComponent(url.searchParams.get("state"))
            );
        }
      }
    });
    const input = {
      requestUrl: new URL(resource),
      response: new Response(null, { status: 401 }),
      challenge: null,
      discovery: discovery(),
      fetch: async () => {
        fetches++;
        return Response.json({ access_token: "new", token_type: "Bearer" });
      }
    };
    const first = provider.handleUnauthorized(input);
    await entered.promise;
    const second = provider.handleUnauthorized(input);
    await Promise.resolve();
    await Promise.resolve();
    release.resolve();
    const result = await Promise.all([first, second]);
    const observed = {
      result,
      browsers,
      fetches,
      calls: store.calls,
      closed: servers.map((server) => server.closed)
    };
    if (factory === reference) baseline = observed;
    else assert.deepEqual(observed, baseline);
  }
});
test("native policy envelopes ignore inherited action fields", async () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "action");
  try {
    Object.defineProperty(Object.prototype, "action", {
      value: "load",
      writable: true,
      configurable: true
    });
    let baseline;
    for (const factory of [reference, own]) {
      const store = storage();
      let browser = 0,
        fetches = 0;
      let server;
      const provider = factory.createDefaultOAuthClientProvider({
        client: { mode: "static", clientId: "client" },
        sessionStore: store,
        browser: {
          createServer: () => (server = new Server()),
          openBrowser: async (value) => {
            browser++;
            const url = new URL(value);
            server.request(
              "/callback?code=code&state=" + encodeURIComponent(url.searchParams.get("state"))
            );
          }
        }
      });
      const d = discovery();
      d.authorizationServerMetadata.registration_endpoint = issuer + "/register";
      const result = await provider.handleUnauthorized({
        requestUrl: new URL(resource),
        response: new Response(null, { status: 401 }),
        challenge: null,
        discovery: d,
        fetch: async () => {
          fetches++;
          return Response.json({ access_token: "new", token_type: "Bearer" });
        }
      });
      const observed = { result: summarize(result), browser, fetches, calls: store.calls };
      if (factory === reference) baseline = observed;
      else assert.deepEqual(observed, baseline);
    }
  } finally {
    if (original) Object.defineProperty(Object.prototype, "action", original);
    else delete Object.prototype.action;
  }
});
test("dynamic clients reuse successful registration on transient retry and reregister only stored invalid clients", async () => {
  for (const scenario of ["transient", "invalidStored", "invalidStatic"]) {
    let expected;
    for (const factory of [reference, own]) {
      const store = storage(
          scenario === "invalidStored" ? { ...session(), tokens: undefined } : null
        ),
        servers = [],
        calls = [];
      let tokens = 0,
        browsers = 0;
      const provider = factory.createDefaultOAuthClientProvider({
        client: {
          mode: scenario === "invalidStatic" ? "static" : "dynamic",
          clientId: scenario === "invalidStatic" ? "static" : undefined
        },
        sessionStore: store,
        browser: {
          createServer: () => {
            const server = new Server();
            servers.push(server);
            return server;
          },
          openBrowser: async (value) => {
            browsers++;
            const url = new URL(value);
            servers
              .at(-1)
              .request(
                "/callback?code=code&state=" + encodeURIComponent(url.searchParams.get("state"))
              );
          }
        }
      });
      const d = discovery();
      d.authorizationServerMetadata.registration_endpoint = issuer + "/register";
      const fetch = async (url, init) => {
        if (String(url).endsWith("/register")) {
          calls.push({ url, body: JSON.parse(init.body) });
          return Response.json({ client_id: "dynamic" });
        }
        const params = Object.fromEntries(new URLSearchParams(init.body));
        params.code_verifier = !!params.code_verifier;
        calls.push({ url, body: params });
        if (tokens++ === 0)
          return Response.json(
            { error: scenario === "transient" ? "server_error" : "invalid_client" },
            { status: scenario === "transient" ? 503 : 400 }
          );
        return Response.json({ access_token: "new", token_type: "Bearer" });
      };
      const result = await provider.handleUnauthorized({
        requestUrl: new URL(resource),
        response: new Response(null, { status: 401 }),
        challenge: null,
        discovery: d,
        fetch
      });
      const observed = {
        result: summarize(result),
        calls,
        browsers,
        store: store.calls,
        value: store.value(),
        closed: servers.map((server) => server.closed)
      };
      if (factory === reference) expected = observed;
      else assert.deepEqual(observed, expected);
    }
  }
});
test("aborted registration/token readers release bodies, close callbacks and permit a fresh attempt", async () => {
  const original = AbortSignal.timeout;
  try {
    for (const factory of [reference, own])
      for (const stalled of ["register", "token"]) {
        const deadline = new AbortController(),
          entered = deferred();
        const reason = new Error("deadline exceeded");
        let cancelled = 0,
          first = true;
        const response = new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            }
          })
        );
        const store = storage(),
          servers = [];
        const provider = factory.createDefaultOAuthClientProvider({
          client: {
            mode: stalled === "register" ? "dynamic" : "static",
            clientId: stalled === "token" ? "client" : undefined
          },
          sessionStore: store,
          browser: {
            createServer: () => {
              const server = new Server();
              servers.push(server);
              return server;
            },
            openBrowser: async (value) => {
              const url = new URL(value);
              servers
                .at(-1)
                .request(
                  "/callback?code=code&state=" + encodeURIComponent(url.searchParams.get("state"))
                );
            }
          }
        });
        const d = discovery();
        d.authorizationServerMetadata.registration_endpoint = issuer + "/register";
        const input = {
          requestUrl: new URL(resource),
          response: new Response(null, { status: 401 }),
          challenge: null,
          discovery: d,
          fetch: async (url) => {
            if (first && String(url).endsWith("/" + stalled)) {
              first = false;
              entered.resolve();
              return response;
            }
            return Response.json(
              String(url).endsWith("/register")
                ? { client_id: "client" }
                : { access_token: "new", token_type: "Bearer" }
            );
          }
        };
        AbortSignal.timeout = () => deadline.signal;
        const pending = provider.handleUnauthorized(input);
        await entered.promise;
        await new Promise(setImmediate);
        assert.equal(response.body.locked, true);
        deadline.abort(reason);
        const failed = await pending;
        assert.equal(failed.action, "fail");
        assert.equal(failed.error, reason);
        assert.equal(cancelled, 1);
        assert.equal(response.body.locked, false);
        assert.equal(servers[0].closed, 1);
        AbortSignal.timeout = original;
        assert.deepEqual(await provider.handleUnauthorized(input), { action: "retry" });
        assert.equal(servers[1].closed, 1);
      }
  } finally {
    AbortSignal.timeout = original;
  }
});
