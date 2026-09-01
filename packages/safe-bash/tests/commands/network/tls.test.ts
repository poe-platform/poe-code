import assert from "node:assert/strict";
import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createNodeHttpTransport } from "../../../src/commands/network/index.js";
import { run } from "./helpers.js";

const certPath = new URL("./tls/cert.pem", import.meta.url);
let cert: Buffer;
let origin: string;
let server: ReturnType<typeof createServer>;
before(async () => {
  cert = await readFile(certPath);
  server = createServer({ cert, key: await readFile(new URL("./tls/key.pem", import.meta.url)) }, (request, response) => {
    response.sendDate = false;
    response.setHeader("Connection", "close");
    if (request.url === "/downgrade") { response.writeHead(302, { Location: "http://127.0.0.1:1/private" }); response.end(); }
    else response.end(Buffer.from([0, 255, 72, 84, 84, 80, 83]));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  origin = `https://127.0.0.1:${address.port}`;
});
after(async () => { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); });

test("HTTPS verifies injected CA without mutating global TLS state", async () => {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const actual = await run([origin], { options: { transport: createNodeHttpTransport({ ca: cert }) } });
  assert.equal(actual.exitCode, 0);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, before);
});

test("untrusted HTTPS certificates fail with curl 60", async () => {
  const result = await run([origin]); assert.equal(result.exitCode, 60); assert.equal(result.stdout.length, 0);
});

test("HTTPS-to-HTTP redirect is rejected before opening the downgrade destination", async () => {
  const visits: string[] = [];
  const result = await run(["-L", origin + "/downgrade"], { options: {
    transport: createNodeHttpTransport({ ca: cert }), authorize: request => { visits.push(request.url); return true; },
  } });
  assert.equal(result.exitCode, 1); assert.deepEqual(visits, [origin + "/downgrade"]);
});
