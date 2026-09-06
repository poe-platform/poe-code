import assert from "node:assert/strict";
import { isIP } from "node:net";
import { test } from "node:test";
import {
  Shell, createMemoryFileSystem, createFetchTransport, createOriginAuthorizer,
  networkCommands, toByteSource, type HttpTransport, type NetworkAuthorization,
  type NetworkAuthorizer,
} from "../../../src/index.js";
import { CurlError, type HttpRequest } from "../../../src/commands/network/types.js";

function fixture(kind: "transport" | "fetch", policy: NetworkAuthorizer, redirect?: string) {
  const admitted: { url: string; redirectFrom?: string; allowed: boolean }[] = [];
  const sent: string[] = [];
  const disposed: string[] = [];
  const authorize = async (request: NetworkAuthorization): Promise<boolean> => {
    const allowed = await policy(request);
    admitted.push({ url: request.url, ...(request.redirectFrom === undefined ? {} : { redirectFrom: request.redirectFrom }), allowed });
    return allowed;
  };
  const literalPolicy = createOriginAuthorizer("*", { denyPrivateNetworks: true });
  const transport: HttpTransport = kind === "transport" ? Object.assign(async (request: HttpRequest) => {
    const selected = new URL(request.url);
    if (!isIP(selected.hostname.replace(/^\[|\]$/gu, ""))) selected.hostname = "8.8.8.8";
    if (request.denyPrivateNetworks && !await literalPolicy({
      url: selected.href, method: request.method, attempt: 0, signal: request.signal,
    })) throw new CurlError(7, "Private address denied");
    sent.push(request.url);
    const location = sent.length === 1 ? redirect : undefined;
    return {
      status: location === undefined ? 200 : 302,
      statusText: location === undefined ? "OK" : "Found",
      headers: location === undefined ? [] : [["Location", location] as const],
      body: toByteSource(location === undefined ? "allowed" : ""),
      async dispose() { disposed.push(request.url); },
    };
  }, { supportsPrivateNetworkDeny: true as const }) : createFetchTransport({ fetch: async input => {
    assert.ok(input instanceof Request);
    assert.equal(input.redirect, "manual");
    assert.equal(input.credentials, "omit");
    sent.push(input.url);
    input.signal.addEventListener("abort", () => { disposed.push(input.url); }, { once: true });
    return sent.length === 1 && redirect !== undefined
      ? new Response(null, { status: 302, headers: { Location: redirect } })
      : new Response("allowed");
  } });
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(networkCommands({ authorize, transport }));
  return { shell, admitted, sent, disposed };
}

const privateDestinations = [
  "http://[::ffff:127.0.0.1]/secret",
  "http://[::ffff:169.254.169.254]/secret",
  "http://[::ffff:10.2.3.4]/secret",
  "http://[::ffff:172.16.0.1]/secret",
  "http://[::ffff:192.168.0.1]/secret",
  "http://[::ffff:0.1.2.3]/secret",
  "http://[::]/secret",
  "http://[::ffff:0:127.0.0.1]/secret",
  "http://[::ffff:0:a9fe:a9fe]/secret",
  "http://[0:0:0:0:FFFF:0:A9FE:A9FE]/secret",
  "http://[64:ff9b::127.0.0.1]/secret",
  "http://[64:ff9b::a9fe:a9fe]/secret",
  "http://[0064:FF9B:0:0:0:0:A9FE:A9FE]/secret",
] as const;

for (const kind of ["transport", "fetch"] as const) {
  for (const destination of privateDestinations) {
    test(`${kind}: private-address denial precedes initial dispatch to ${destination}`, async () => {
      const f = fixture(kind, createOriginAuthorizer("*", { denyPrivateNetworks: true }));
      try {
        const result = await f.shell.exec(`curl '${destination}'`);
        assert.equal(result.exitCode, 7, result.stderr);
        assert.equal(result.stdout, "");
        assert.deepEqual(f.admitted, [{ url: new URL(destination).href, allowed: false }]);
        assert.deepEqual(f.sent, []);
        assert.deepEqual(f.disposed, []);
      } finally { await f.shell.dispose(); }
    });

    test(`${kind}: ${kind === "fetch" ? "unsupported private policy refuses initial hop before redirect to" : "denied redirect releases prior response without dispatch to"} ${destination}`, async () => {
      const initial = "http://public.example/start";
      const f = fixture(kind, createOriginAuthorizer("*", { denyPrivateNetworks: true }), destination);
      try {
        const result = await f.shell.exec(`curl -L '${initial}'`);
        assert.equal(result.exitCode, 7, result.stderr);
        assert.equal(result.stdout, "");
        assert.deepEqual(f.admitted, kind === "fetch" ? [{ url: initial, allowed: true }] : [
          { url: initial, allowed: true },
          { url: new URL(destination).href, redirectFrom: initial, allowed: false },
        ]);
        assert.deepEqual(f.sent, kind === "fetch" ? [] : [initial]);
        assert.deepEqual(f.disposed, kind === "fetch" ? [] : [initial]);
      } finally { await f.shell.dispose(); }
      assert.deepEqual(f.disposed, kind === "fetch" ? [] : [initial], "shell disposal does not repeat response cleanup");
    });
  }

  for (const destination of ["http://0/", "http://localhost./", "http://[fe80::1]/", "http://[fd00::1]/"]) {
    test(`${kind}: existing private-address refusal remains intact for ${destination}`, async () => {
      const f = fixture(kind, createOriginAuthorizer("*", { denyPrivateNetworks: true }));
      try {
        const result = await f.shell.exec(`curl '${destination}'`);
        assert.equal(result.exitCode, 7, result.stderr);
        assert.deepEqual(f.sent, []);
      } finally { await f.shell.dispose(); }
    });
  }

  for (const destination of [
    "http://[::ffff:8.8.8.8]/ok", "http://[2001:4860:4860::8888]/ok", "http://public.example/ok",
    "http://[::ffff:0:8.8.8.8]/ok", "http://[64:ff9b::8.8.8.8]/ok",
    "http://[::ffff:1:7f00:1]/ok", "http://[64:ff9b:0:0:1:0:7f00:1]/ok",
  ]) {
    test(`${kind}: ${kind === "fetch" ? "unsupported private policy refuses even public destination" : "public destination remains allowed and identical at each hop"}: ${destination}`, async () => {
      const initial = "http://public.example/start";
      const f = fixture(kind, createOriginAuthorizer("*", { denyPrivateNetworks: true }), destination);
      try {
        const result = await f.shell.exec(`curl -L '${initial}'`);
        assert.equal(result.exitCode, kind === "fetch" ? 7 : 0, result.stderr);
        assert.equal(result.stdout, kind === "fetch" ? "" : "allowed");
        assert.deepEqual(f.admitted, kind === "fetch" ? [{ url: initial, allowed: true }] : [
          { url: initial, allowed: true },
          { url: new URL(destination).href, redirectFrom: initial, allowed: true },
        ]);
        assert.deepEqual(f.sent, kind === "fetch" ? [] : f.admitted.map(request => request.url));
        assert.deepEqual(f.disposed, f.sent);
      } finally { await f.shell.dispose(); }
    });
  }

  for (const destination of ["http://[::ffff:0:127.0.0.1]/secret", "http://[64:ff9b::127.0.0.1]/secret"]) {
    test(`${kind}: explicit translated-private allowlist cannot bypass opt-in filtering for ${destination}`, async () => {
      const f = fixture(kind, createOriginAuthorizer([new URL(destination).origin], { denyPrivateNetworks: true }));
      try {
        const result = await f.shell.exec(`curl '${destination}'`);
        assert.equal(result.exitCode, 7, result.stderr);
        assert.deepEqual(f.admitted, [{ url: new URL(destination).href, allowed: false }]);
        assert.deepEqual(f.sent, []);
        assert.deepEqual(f.disposed, []);
      } finally { await f.shell.dispose(); }
    });

    for (const options of [undefined, { denyPrivateNetworks: false }]) {
      test(`${kind}: translated-private dispatch remains opt-in for ${destination} (${options === undefined ? "omitted" : "false"})`, async () => {
        const initial = "http://public.example/start";
        const f = fixture(kind, createOriginAuthorizer([new URL(initial).origin, new URL(destination).origin], options), destination);
        try {
          const result = await f.shell.exec(`curl -L '${initial}'`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout, "allowed");
          assert.deepEqual(f.sent, [initial, new URL(destination).href]);
          assert.deepEqual(f.sent, f.admitted.map(request => request.url));
          assert.ok(f.admitted.every(request => request.allowed));
          assert.deepEqual(f.disposed, f.sent);
        } finally { await f.shell.dispose(); }
      });
    }
  }

  for (const options of [undefined, { denyPrivateNetworks: false }]) {
    test(`${kind}: private-address refusal remains opt-in (${options === undefined ? "omitted" : "false"})`, async () => {
      const initial = "http://[::ffff:127.0.0.1]/start";
      const destination = "http://[::]/end";
      const f = fixture(kind, createOriginAuthorizer("*", options), destination);
      try {
        const result = await f.shell.exec(`curl -L '${initial}'`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "allowed");
        assert.deepEqual(f.sent, [new URL(initial).href, new URL(destination).href]);
        assert.deepEqual(f.sent, f.admitted.map(request => request.url));
        assert.ok(f.admitted.every(request => request.allowed));
        assert.deepEqual(f.disposed, f.sent);
      } finally { await f.shell.dispose(); }
    });
  }
}
