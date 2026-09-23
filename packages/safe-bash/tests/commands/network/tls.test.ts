import assert from "node:assert/strict";
import https, { createServer, type RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createFetchTransport, createNodeHttpTransport, networkCommands } from "../../../src/commands/network/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { fixture, run } from "./helpers.js";

const certPath = new URL("./tls/cert.pem", import.meta.url);
let cert: Buffer;
let origin: string;
let server: ReturnType<typeof createServer>;
let acquisition: Promise<void> | undefined;
before(() => {
  acquisition = (async () => {
    cert = await readFile(certPath);
    server = createServer({ cert, key: await readFile(new URL("./tls/key.pem", import.meta.url)) }, (request, response) => {
      response.sendDate = false;
      response.setHeader("Connection", "close");
      if (request.url === "/downgrade") { response.writeHead(302, { Location: "http://127.0.0.1:1/private" }); response.end(); }
      else if (request.url === "/redirect") { response.writeHead(302, { Location: "/" }); response.end(); }
      else response.end(Buffer.from([0, 255, 72, 84, 84, 80, 83]));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    origin = `https://127.0.0.1:${address.port}`;
  })();
  return acquisition;
});
after(async () => {
  await acquisition;
  if (server) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
});

test("HTTPS verifies injected CA without mutating global TLS state", async () => {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const actual = await run(["--connect-timeout", "1", origin], { options: { transport: createNodeHttpTransport({ ca: cert }) } });
  assert.equal(actual.exitCode, 0);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, before);
});

test("untrusted HTTPS certificates fail with curl 60", async () => {
  const result = await run([origin]); assert.equal(result.exitCode, 60); assert.equal(result.stdout.length, 0);
});

test("curl trusts an explicit VFS CA only for its request", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/ca.pem", cert);
  const transport = createNodeHttpTransport();
  for (const args of [["--cacert", "ca.pem"], ["--cacert=ca.pem"]]) {
    const result = await run([...args, origin], { fs, options: { transport } });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, Buffer.from([0, 255, 72, 84, 84, 80, 83]));
  }
  assert.equal((await run([origin], { fs, options: { transport } })).exitCode, 60);
});

test("unreadable and oversized CA files fail before transport starts", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/large.pem", new Uint8Array(1025));
  for (const file of ["missing.pem", "large.pem"]) {
    const result = await run(["--cacert", file, origin], { fs, options: { limits: { maxBufferBytes: 1024 } } });
    assert.equal(result.exitCode, 77);
    assert.equal(result.stdout.length, 0);
  }
});

test("Shell curl retains VFS CA trust across authorized HTTPS redirects", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/ca.pem", cert);
  const visits: string[] = [];
  const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({ authorize: request => {
    visits.push(request.url);
    return new URL(request.url).origin === origin;
  } }));
  try {
    const result = await shell.exec(`curl -sS -L --cacert ca.pem ${origin}/redirect`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(visits, [origin + "/redirect", origin + "/"]);
  } finally { await shell.dispose(); }
});

test("transports must explicitly support request CA trust", async () => {
  let called = false;
  const result = await run(["--cacert", "ca.pem", origin], { options: {
    transport: async () => { called = true; throw new Error("Must not start"); },
  } });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /Transport cannot enforce request CA trust/);
  assert.equal(called, false);
});

test("Fetch refuses supplied CA bytes before making a request", async () => {
  let called = false;
  const transport = createFetchTransport({ fetch: async () => { called = true; throw new Error("Must not start"); } });
  await assert.rejects(transport({ url: origin, method: "GET", headers: [], ca: cert,
    signal: new AbortController().signal }), { exitCode: 2 });
  assert.equal(called, false);
});

test("HTTPS-to-HTTP redirect is rejected before opening the downgrade destination", async () => {
  const visits: string[] = [];
  const result = await run(["-L", origin + "/downgrade"], { options: {
    transport: createNodeHttpTransport({ ca: cert }), authorize: request => { visits.push(request.url); return true; },
  } });
  assert.equal(result.exitCode, 1); assert.deepEqual(visits, [origin + "/downgrade"]);
});

for (const hostname of ["public.example", "93.184.216.34", "[2606:4700::1111]"]) {
  test(`protected TLS validates original ${hostname}, not explicit Host or fixture dial address`, async context => {
    const nativeRequest = https.request;
    const calls: { url: string; options: RequestOptions }[] = [];
    context.mock.method(https, "request", (url: URL, options: RequestOptions, listener: (response: IncomingMessage) => void) => {
      calls.push({ url: url.href, options });
      const fixtureUrl = new URL(url);
      fixtureUrl.hostname = "127.0.0.1";
      return nativeRequest(fixtureUrl, { ...options, family: 4 }, listener);
    });
    syncBuiltinESMExports();
    context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
    const port = new URL(origin).port;
    const url = `https://${hostname}:${port}/`;
    const transport = createNodeHttpTransport({ resolveAddress: async () => ({ address: "93.184.216.34", family: 4 }) });
    let cleanup: (() => Promise<void>) | undefined;
    try {
      await assert.rejects(transport({ url, headers: [["Host", "localhost"]], method: "GET",
        signal: new AbortController().signal, denyPrivateNetworks: true, ca: cert,
        registerCleanup: dispose => { cleanup = () => Promise.resolve(dispose()); },
      }).then(response => response.dispose()), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    } finally { await cleanup?.(); }
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, url);
    assert.equal(calls[0]!.options.servername, hostname === "public.example" ? hostname : "");
    assert.equal(calls[0]!.options.rejectUnauthorized, true);
    assert.equal(calls[0]!.options.agent, false);
    assert.deepEqual(calls[0]!.options.headers, { host: "localhost" });
  });
}
