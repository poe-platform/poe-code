import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { nativeCurl, run, server, type TestServer } from "./helpers.js";

let host: TestServer;
before(async () => { host = await server(); });
after(async () => { await host.close(); });

const cases: readonly { name: string; args: string[]; path?: string; stdin?: string | Uint8Array }[] = [
  { name: "GET binary", args: [], path: "/bytes" },
  { name: "GET echo", args: [] },
  { name: "DELETE custom method", args: ["-X", "DELETE"] },
  { name: "custom header", args: ["-H", "X-Test: abc"] },
  { name: "repeated headers", args: ["-H", "X-Test: one", "-H", "X-Test: two"] },
  { name: "basic authentication", args: ["-u", "user:p:a:ss"] },
  { name: "bearer authentication", args: ["--oauth2-bearer", "a-token"] },
  { name: "literal POST data", args: ["-d", "alpha=one", "-d", "beta=two"] },
  { name: "raw at is literal", args: ["--data-raw", "@not-a-file"] },
  { name: "JSON", args: ["--json", '{"ok":true}'] },
  { name: "JSON concatenation", args: ["--json", '{"ok":', "--json", "true}"] },
  { name: "stdin binary", args: ["--data-binary", "@-"], stdin: Uint8Array.from([0, 255, 13, 10, 195, 169]) },
  { name: "stdin data strips CR LF NUL", args: ["-d", "@-"], stdin: Uint8Array.from([97, 13, 10, 0, 98]) },
  { name: "PUT stdin", args: ["-T", "-"], stdin: "upload\0bytes" },
  { name: "encoded query", args: ["-G", "--data-urlencode", "q=a b&é", "--data-urlencode", "x=1"], path: "/echo?initial=ok" },
  { name: "encoded stdin query", args: ["-G", "--data-urlencode", "q@-"], stdin: "a b\n" },
  { name: "encoded POST", args: ["--data-urlencode", "q=a b&é"] },
  { name: "GET rejects literal whitespace", args: ["-G", "--data-raw", "q=a b"] },
  { name: "content type suppression", args: ["-d", "x", "-H", "Content-Type:"] },
  { name: "HEAD", args: ["-I"], path: "/bytes" },
  { name: "include headers", args: ["-i"], path: "/bytes" },
  { name: "HTTP failure default is zero", args: [], path: "/fail" },
  { name: "HTTP fail discards body", args: ["-f"], path: "/fail" },
  { name: "HTTP fail retains body", args: ["--fail-with-body"], path: "/fail" },
  { name: "silent HTTP failure", args: ["-sf"], path: "/fail" },
  { name: "silent show error", args: ["-sSf"], path: "/fail" },
  { name: "writeout", args: ["-w", "\\n%{http_code}|%{size_download}|%{content_type}|%%"], path: "/bytes" },
  { name: "explicit POST method after redirect", args: ["-L", "-X", "POST", "-d", "body"], path: "/redirect/302" },
  ...[301, 302, 303, 307, 308].map(status => ({ name: `POST redirect ${status}`, args: ["-L", "--data-binary", "payload"], path: `/redirect/${status}` })),
  { name: "stdin redirect replay", args: ["-L", "--data-binary", "@-"], stdin: "replay body", path: "/redirect/307" },
];

for (const row of cases) test(`native curl: ${row.name}`, { timeout: 8000 }, async () => {
  const args = [...row.args, host.origin + (row.path ?? "/echo")];
  const stdin = typeof row.stdin === "string" ? Buffer.from(row.stdin) : row.stdin;
  const expected = await nativeCurl(args, stdin);
  const actual = await run(args, row.stdin === undefined ? {} : { stdin: row.stdin });
  assert.equal(actual.exitCode, expected.exitCode);
  assert.deepEqual(actual.stdout, expected.stdout);
  if (actual.exitCode !== 0) assert.equal(actual.stderr.length > 0, expected.stderr.length > 0);
});

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
