import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { gzipSync, deflateSync } from "node:zlib";
import { createFetchTransport, networkCommands } from "../../../src/commands/network/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, server, type TestServer } from "./helpers.js";

let host: TestServer;
let acquisition: Promise<TestServer> | undefined;
before(async () => { acquisition = server(); host = await acquisition; });
after(async () => { await (await acquisition)?.close(); });

for (const status of [301, 302, 303, 307, 308]) {
  for (const method of [undefined, "POST", "PUT", "PATCH"]) {
    test(`Shell curl ${status} redirect handles POST data with ${method ?? "implicit POST"}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(networkCommands({
        authorize: request => new URL(request.url).origin === host.origin,
      }));
      try {
        const result = await shell.exec(`curl -sS -L ${method ? `-X ${method}` : ""} --data x ${host.origin}/redirect/${status}`);
        assert.equal(result.exitCode, 0, result.stderr);
        const [initial, final] = host.requests.slice(-2);
        assert.equal(initial!.method, method ?? "POST");
        assert.equal(initial!.body.toString(), "x");
        assert.equal(initial!.headers["content-type"], "application/x-www-form-urlencoded");
        const discarded = status === 301 || status === 302 || status === 303;
        assert.equal(final!.method, method ?? (discarded ? "GET" : "POST"));
        assert.equal(final!.body.toString(), discarded ? "" : "x");
        assert.equal(final!.headers["content-type"], discarded ? undefined : "application/x-www-form-urlencoded");
      } finally { await shell.dispose(); }
    });
  }
  test(`Shell curl ${status} redirect handles genuine PUT upload`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", Buffer.from("x"));
    const shell = new Shell({ fs }).use(networkCommands({
      authorize: request => new URL(request.url).origin === host.origin,
    }));
    try {
      const result = await shell.exec(`curl -sS -L -T /input ${host.origin}/redirect/${status}`);
      assert.equal(result.exitCode, 0, result.stderr);
      const final = host.requests.at(-1)!;
      assert.equal(final.method, status === 303 ? "GET" : "PUT");
      assert.equal(final.body.toString(), status === 303 ? "" : "x");
      assert.equal(final.headers["content-type"], undefined);
    } finally { await shell.dispose(); }
  });
}

test("Shell curl matches curl 8.5/8.10 empty-file URL encoding for POST and GET", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  await fs.writeFile("/input", Buffer.from("hello world"));
  const shell = new Shell({ fs }).use(networkCommands({ authorize: request => new URL(request.url).origin === host.origin }));
  try {
    for (const get of [false, true]) {
      for (const [argument, expected] of [
        ["audit@/empty", ""], ["@/empty", ""], ["audit=", "audit="],
        ["audit@/input", "audit=hello+world"], ["@/input", "hello+world"],
      ]) {
        const result = await shell.exec(`curl -sS ${get ? "-G" : ""} --data-urlencode '${argument}' ${host.origin}/echo`);
        assert.equal(result.exitCode, 0, result.stderr);
        const request = host.requests.at(-1)!;
        assert.equal(request.method, get ? "GET" : "POST");
        assert.equal(request.path, get && expected ? `/echo?${expected}` : "/echo");
        assert.equal(request.body.toString(), get ? "" : expected);
        assert.equal(request.headers["content-type"], get ? undefined : "application/x-www-form-urlencoded");
      }
    }
  } finally { await shell.dispose(); }
});

test("Shell curl joins data using curl 8.10.1 accumulated-byte semantics", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  await fs.writeFile("/stripped", Buffer.from([0, 10, 13]));
  const shell = new Shell({ fs }).use(networkCommands({ authorize: request => new URL(request.url).origin === host.origin }));
  try {
    for (const [data, expected] of [
      ["--data '' --data SYNTHETIC", "SYNTHETIC"],
      ["--data @/empty --data SYNTHETIC", "SYNTHETIC"],
      ["--data @- --data SYNTHETIC", "SYNTHETIC"],
      ["--data @/stripped --data SYNTHETIC", "SYNTHETIC"],
      ["--data '' --data @/empty --data '' --data SYNTHETIC", "SYNTHETIC"],
      ["--data SYNTHETIC --data ''", "SYNTHETIC&"],
      ["--data SYNTHETIC --data '' --data NEXT", "SYNTHETIC&&NEXT"],
      ["--data FIRST --data NEXT", "FIRST&NEXT"],
      ["--data '' --data @/empty", ""],
      ["--data-binary @/stripped --data NEXT", "\0\n\r&NEXT"],
      ["--json '' --json SYNTHETIC --json NEXT", "SYNTHETICNEXT"],
    ]) {
      const result = await shell.exec(`curl ${data} ${host.origin}/echo`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).body, Buffer.from(expected!).toString("hex"), data);
    }
  } finally { await shell.dispose(); }
});

test("Shell curl sends byte ranges and streams partial responses", async () => {
  const bodies = new Map([
    ["bytes=0-2", { body: "hel", contentRange: "bytes 0-2/6" }],
    ["bytes=3-", { body: "lo\n", contentRange: "bytes 3-5/6" }],
    ["bytes=-2", { body: "o\n", contentRange: "bytes 4-5/6" }],
  ]);
  const ranges: (string | undefined)[] = [];
  const partial = await server((request, response) => {
    ranges.push(request.headers.range);
    const selected = bodies.get(request.headers.range ?? "");
    if (!selected) { response.writeHead(200); response.end("hello\n"); return true; }
    response.writeHead(206, { "Content-Range": selected.contentRange, "Content-Length": Buffer.byteLength(selected.body) });
    response.end(selected.body);
    return true;
  });
  try {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs }).use(networkCommands({ authorize: request => new URL(request.url).origin === partial.origin }));
    for (const [option, expected] of [
      ["--range 0-2", "hel"], ["-r 0-2", "hel"], ["-r0-2", "hel"],
      ["--range 3-", "lo\n"], ["--range -2", "o\n"], ["--range=0-2", "hel"],
      ["-r 3- --range 0-2", "hel"], ["--range 0-2 -H 'Range: bytes=-2'", "o\n"],
    ]) {
      const result = await shell.exec(`curl ${option} -w ':%{http_code}:%{size_download}' ${partial.origin}/hello`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `${expected}:206:${Buffer.byteLength(expected!)}`);
    }
    const output = await shell.exec(`curl --range 0-2 -o /partial ${partial.origin}/hello`);
    assert.equal(output.exitCode, 0, output.stderr);
    assert.equal(output.stdout, "");
    assert.deepEqual(Buffer.from(await fs.readFile("/partial")), Buffer.from("hel"));
    const suppressed = await shell.exec(`curl --range 0-2 -H 'Range:' ${partial.origin}/hello`);
    assert.equal(suppressed.exitCode, 0, suppressed.stderr);
    assert.equal(suppressed.stdout, "hello\n");
    assert.deepEqual(ranges, ["bytes=0-2", "bytes=0-2", "bytes=0-2", "bytes=3-", "bytes=-2", "bytes=0-2", "bytes=0-2", "bytes=-2", "bytes=0-2", undefined]);
  } finally { await partial.close(); }
});

test("Shell curl accepts separate and equals connection timeouts", async () => {
  const hello = await server((_request, response) => { response.end("hello\n"); return true; });
  try {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(networkCommands({ authorize: () => true }));
    for (const option of ["--connect-timeout 1", "--connect-timeout=0.5", "--connect-timeout 0"]) {
      const result = await shell.exec(`curl ${option} ${hello.origin}/hello`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "hello\n");
    }
  } finally { await hello.close(); }
});

test("connection timeout stops at TCP connection, before response headers or body", async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const delayed = await server((_request, response) => {
    timer = setTimeout(() => { response.write("hello"); timer = setTimeout(() => response.end("\n"), 40); }, 40);
    return true;
  });
  try {
    const result = await run(["--connect-timeout", "0.02", "--max-time", "1", delayed.origin]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "hello\n");
  } finally { clearTimeout(timer); await delayed.close(); }
});

test("Fetch refuses connection deadlines it cannot enforce", async () => {
  let calls = 0;
  const transport = createFetchTransport({ fetch: async () => { calls++; return new Response("hello\n"); } });
  const result = await run(["--connect-timeout", "1", host.origin], { options: { transport } });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /connection timeout/);
  assert.equal(calls, 0);
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

test("compressed responses decode while raw responses retain encoded bytes", async () => {
  const plain = Buffer.from("hello\n");
  const gzip = gzipSync(plain);
  const requests: (string | undefined)[] = [];
  const compressed = await server((request, response) => {
    requests.push(request.headers["accept-encoding"]);
    const bytes = request.url === "/deflate" ? deflateSync(plain) : gzip;
    response.writeHead(200, { "Content-Encoding": request.url === "/deflate" ? "deflate" : "gzip", "Content-Length": bytes.length });
    response.end(bytes);
    return true;
  });
  try {
    for (const path of ["/gzip", "/deflate"]) {
      const result = await run(["--compressed", "-w", ":%{size_download}", compressed.origin + path]);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      const length = path === "/gzip" ? gzip.length : deflateSync(plain).length;
      assert.equal(result.stdout.toString(), `hello\n:${length}`);
    }
    for (const flags of [["--raw"], ["--compressed", "--raw"]]) {
      const result = await run([...flags, compressed.origin + "/gzip"]);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(result.stdout, gzip);
    }
    assert.deepEqual(requests, ["gzip, deflate", "gzip, deflate", undefined, "gzip, deflate"]);
    const output = await run(["--compressed", "-o", "decoded", compressed.origin + "/gzip"]);
    assert.equal(output.exitCode, 0, output.stderr.toString());
    assert.deepEqual(Buffer.from(await output.fs.readFile("/work/decoded")), plain);
  } finally { await compressed.close(); }
});

test("compressed Fetch content is decoded once and raw encoded content is refused", async () => {
  const transport = createFetchTransport({ fetch: async () => new Response("hello\n", {
    headers: { "Content-Encoding": "gzip", "Content-Length": "26" },
  }) });
  const decoded = await run(["--compressed", "http://127.0.0.1/"], { options: { transport } });
  assert.equal(decoded.exitCode, 0, decoded.stderr.toString());
  assert.equal(decoded.stdout.toString(), "hello\n");
  const raw = await run(["--raw", "http://127.0.0.1/"], { options: { transport } });
  assert.equal(raw.exitCode, 61);
});

test("raw body limitations do not reject head requests", async () => {
  const raw = await server((_request, response) => {
    response.writeHead(200, { "Transfer-Encoding": "chunked" });
    response.end();
    return true;
  });
  try {
    const result = await run(["--raw", "--head", raw.origin]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
  } finally { await raw.close(); }
});

test("compressed body decoding obeys the transfer deadline", async () => {
  const stalled = await server((_request, response) => {
    response.writeHead(200, { "Content-Encoding": "gzip" });
    response.write(gzipSync(Buffer.from("hello\n")).subarray(0, 10));
    return true;
  });
  try {
    const result = await run(["--compressed", "--max-time", "0.05", stalled.origin]);
    assert.equal(result.exitCode, 28, result.stderr.toString());
  } finally { await stalled.close(); }
});

test("compressed responses enforce decoded quotas and reject invalid or unknown encodings", async () => {
  const compressed = await server((request, response) => {
    const bytes = request.url === "/invalid" ? Buffer.from("invalid") : gzipSync(Buffer.alloc(1000, 65));
    response.writeHead(200, { "Content-Encoding": request.url === "/unknown" ? "unknown" : "gzip", "Content-Length": bytes.length });
    response.end(bytes);
    return true;
  });
  try {
    const limited = await run(["--compressed", compressed.origin], { options: { limits: { maxDownloadBytes: 100 } } });
    assert.equal(limited.exitCode, 63);
    assert.equal(limited.stdout.length, 0);
    for (const path of ["/invalid", "/unknown"]) {
      const result = await run(["--compressed", compressed.origin + path]);
      assert.equal(result.exitCode, 61, result.stderr.toString());
    }
  } finally { await compressed.close(); }
});
