import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { run, server, type TestServer } from "./helpers.js";

let host: TestServer;
before(async () => { host = await server(); });
after(async () => { await host.close(); });

test("per-hop authorization and cross-origin custom credentials are removed", async () => {
  const destination = await server();
  const origin = await server((_request, response) => { response.writeHead(302, { Location: destination.origin + "/echo" }); response.end(); return true; });
  try {
    const visits: string[] = [];
    const result = await run(["-L", "-u", "user:secret", "-H", "X-Test: custom-secret", "-H", "Cookie: session=private", origin.origin], {
      options: { authorize(request) { visits.push(request.url); return true; } },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(visits, [origin.origin + "/", destination.origin + "/echo"]);
    const echo = JSON.parse(result.stdout.toString());
    assert.equal(echo.authorization, null); assert.equal(echo.custom, null); assert.equal(echo.cookie, null);
    const count = destination.requests.length;
    const denied = await run(["-L", origin.origin], { options: { authorize: request => new URL(request.url).origin === origin.origin } });
    assert.equal(denied.exitCode, 7); assert.equal(destination.requests.length, count);
  } finally { await origin.close(); await destination.close(); }
});

test("retry status and bounded fractional delay", async () => {
  const result = await run(["--retry", "2", "--retry-delay", "0.001", "-w", ":%{num_retries}", host.origin + "/retry-author"]);
  assert.equal(result.exitCode, 0); assert.equal(result.stdout.toString(), "retryretryrecovered:2");
  assert.equal(host.retries.get("/retry-author"), 3);
});

test("redirect quota reports curl 47 without infinite requests", async () => {
  const result = await run(["-L", "--max-redirs", "2", host.origin + "/loop"]);
  assert.equal(result.exitCode, 47);
});

test("verbose diagnostics never expose credential header values", async () => {
  const result = await run(["-v", "-u", "user:super-secret", "-H", "X-Test: hidden-custom-token", host.origin + "/echo"]);
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.stderr.toString(), /super-secret|hidden-custom-token|dXNlcjpzdXBlci1zZWNyZXQ=/);
  assert.match(result.stderr.toString(), /redacted/);
});
