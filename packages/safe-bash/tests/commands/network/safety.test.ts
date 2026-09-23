import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectBytes, FsError, toByteSource, type ByteSource } from "../../../src/contracts/index.js";
import { createCurlCommand, type HttpRequest, type HttpResponse } from "../../../src/commands/network/index.js";
import { fixture, run, server } from "./helpers.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { parseArguments } from "../../../src/commands/network/args.js";
import { defaultNetworkLimits } from "../../../src/commands/network/index.js";

test("curl accepts native finite timeout spellings and preserves host caps", async () => {
  const host = await server();
  const shell = new Shell({ fs: await fixture(), cwd: "/work" }).use(networkCommands({ authorize: () => true }));
  try {
    for (const option of ["--max-time", "--connect-timeout"]) {
      for (const [value, seconds] of [[".75", 0.75], ["3.", 3], ["+3.5", 3.5], ["3E+0", 3],
        ["0x1.8p1", 3], [" \t3", 3], ["-0.00", 0], ["0X.8P+2", 2], ["1e-2", 0.01]] as const) {
        const parsed = parseArguments([option, value, "http://127.0.0.1/"], defaultNetworkLimits);
        assert.equal(option === "--max-time" ? parsed.maxTimeMs : parsed.connectTimeoutMs,
          seconds === 0 ? (option === "--max-time" ? defaultNetworkLimits.maxTimeMs : undefined) : seconds * 1000);
        const result = await shell.exec(`curl -s ${option} '${value}' '${host.origin}/bytes'`);
        const native = await promisify(execFile)("/usr/bin/curl", ["-q", "-sS", "--noproxy", "*", option, value, `${host.origin}/bytes`], { encoding: "buffer" });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(Buffer.from(result.stdoutBytes), native.stdout);
      }
      const capped = parseArguments([option, "3E+0", "http://127.0.0.1/"], { ...defaultNetworkLimits, maxTimeMs: 100 });
      assert.equal(option === "--max-time" ? capped.maxTimeMs : capped.connectTimeoutMs, 100);
    }
  } finally { await shell.dispose(); await host.close(); }
});

test("curl rejects malformed, negative and nonfinite timeout operands before transport", async () => {
  for (const option of ["--max-time", "--connect-timeout"]) {
    for (const value of ["", " ", "3 ", "3s", "-0.1", "NaN", "Infinity", "1e999", "0x1p9999", ".", "1e", "0x.p1", "0x1p", "0b11"]) {
      let calls = 0;
      const result = await run([option, value, "http://127.0.0.1/"], { options: { transport: async () => { calls++; return response(); } } });
      assert.equal(result.exitCode, 2, value);
      assert.equal(calls, 0, value);
    }
  }
});

function response(body: ByteSource = toByteSource("ok")): HttpResponse {
  return { status: 200, statusText: "OK", headers: [], body, async dispose() {} };
}

test("multipart Content-Type preserves MIME parameters and following form attributes", async () => {
  for (const option of ["-F", "--form"]) {
    for (const type of ['text/plain;charset=UTF-8', 'application/json; charset="UTF-8"', 'text/plain;note="a;b";charset=UTF-8']) {
      for (const value of ["inline", "@input", "<input"]) {
        const fs = await fixture();
        const payload = Buffer.from([249, 0, 248, 10]);
        await fs.writeFile("/work/input", payload);
        let body = Buffer.alloc(0);
        const result = await run([option, `field=${value};type=${type};filename=chosen`, "http://127.0.0.1/"], { fs, options: {
          transport: async request => {
            body = Buffer.from(await collectBytes(request.body!, { signal: request.signal, maxBytes: 100000 }));
            return response();
          },
        } });
        assert.equal(result.exitCode, 0, result.stderr.toString());
        assert.ok(body.includes(Buffer.from(`Content-Type: ${type}\r\n`)), body.toString());
        assert.ok(body.includes(Buffer.from('name="field"; filename="chosen"\r\n')));
        const start = body.indexOf("\r\n\r\n") + 4;
        assert.deepEqual(body.subarray(start, body.lastIndexOf("\r\n--")), value === "inline" ? Buffer.from("inline") : payload);
      }
    }
  }
});

test("multipart MIME parameters reject malformed metadata before transport", async () => {
  for (const type of ['text/plain;charset=UTF-8\r\nInjected: yes', 'text/plain;charset=\0', 'text/plain;charset="unfinished', 'text/plain;charset=', 'text/plain;=UTF-8']) {
    let calls = 0;
    const result = await run(["-F", `field=value;type=${type}`, "http://127.0.0.1/"], { options: {
      transport: async () => { calls++; return response(); },
    } });
    assert.equal(result.exitCode, 2);
    assert.equal(calls, 0);
  }
});

test("Shell multipart charset grammar agrees with native curl and form-string stays literal", async () => {
  const host = await server();
  try {
    const fs = await fixture();
    const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({ authorize: request => new URL(request.url).origin === host.origin }));
    for (const option of ["-F", "--form"]) {
      for (const type of ['text/plain;charset=UTF-8', 'application/json; charset="UTF-8"', 'text/plain;note="a;b";charset=UTF-8']) {
        const field = `field=inline;type=${type};filename=chosen`;
        const actual = await shell.exec(`curl -s ${option === "-F" ? "-F" : "--form "}'${field}' '${host.origin}'`);
        assert.equal(actual.exitCode, 0, actual.stderr);
        const virtual = host.requests.at(-1)!.body;
        await promisify(execFile)("/usr/bin/curl", ["-q", "-sS", "--noproxy", "*", option, field, host.origin]);
        const native = host.requests.at(-1)!.body;
        const part = (body: Buffer) => body.subarray(body.indexOf("\r\n") + 2, body.lastIndexOf("\r\n--"));
        assert.deepEqual(part(virtual), part(native));
      }
    }
    const literal = 'field=inline;type=text/plain;charset=UTF-8';
    const actual = await shell.exec(`curl -s --form-string '${literal}' '${host.origin}'`);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.ok(host.requests.at(-1)!.body.includes(Buffer.from('\r\n\r\ninline;type=text/plain;charset=UTF-8\r\n')));
  } finally { await host.close(); }
});

test("registration requires an explicit authorizer", () => {
  assert.throws(() => createCurlCommand({} as never), /authorizer/);
});

for (const args of [
  ["--range", "0-2\r\nX: injection"], ["-r", "0-2\0"],
  ["--connect-timeout", "NaN"], ["--connect-timeout", "-1"], ["--connect-timeout=Infinity"],
  ["--proxy", "http://proxy.invalid"], ["--netrc"], ["-k"], ["--compressed=true"],
  ["-X", "GET\r\nInjected: bad"], ["-X", "CONNECT"], ["-H", "Authorization: secret\r\nX: injection"],
  ["-H", "Content-Length: 9"], ["-H", "Host: elsewhere"], ["--max-time", "NaN"], ["--retry", "-1"],
  ["--data", "x", "-T", "file"], ["--json", "{}", "-F", "x=y"], ["-u", "user-without-password"],
]) test(`unsupported/malformed arguments fail before networking: ${JSON.stringify(args)}`, async () => {
  let called = false;
  const result = await run([...args, "http://127.0.0.1/"], { options: { transport: async () => { called = true; return response(); } } });
  assert.equal(result.exitCode, 2); assert.equal(called, false);
  assert.doesNotMatch(result.stderr.toString(), /secret|proxy\.invalid|elsewhere|user-without-password/);
});

test("range requests still require host authorization", async () => {
  let calls = 0;
  const result = await run(["--range", "0-2", "http://127.0.0.1/"], { options: {
    authorize: () => false,
    transport: async () => { calls++; return response(); },
  } });
  assert.equal(result.exitCode, 7);
  assert.equal(calls, 0);
});

test("JSON redirects permanently drop cross-origin custom headers and generated credentials", async () => {
  const urls = ["http://127.0.0.1/start", "http://other.example/redirect", "http://127.0.0.1/echo"];
  const visits: string[] = [];
  const requests: HttpRequest[] = [];
  const result = await run(["-L", "--json", "{}", "-u", "synthetic:password",
    "-H", "Content-Type: application/private", "-H", "Accept: application/private",
    "-H", "Cookie: synthetic=session", "-H", "X-Test: synthetic", urls[0]!], { options: {
    authorize(request) { visits.push(request.url); return true; },
    transport: async request => {
      const index = requests.length;
      requests.push(request);
      return index < 2 ? { ...response(), status: 302, headers: [["Location", urls[index + 1]!]] } : response();
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(visits, urls);
  assert.deepEqual(requests.map(request => request.url), urls);
  for (const [index, request] of requests.entries()) {
    const headers = new Map(request.headers.map(([name, value]) => [name.toLowerCase(), value]));
    assert.equal(headers.get("content-type"), index === 0 ? "application/private" : "application/json");
    assert.equal(headers.get("accept"), index === 0 ? "application/private" : "application/json");
    assert.equal(headers.has("authorization"), index === 0);
    assert.equal(headers.has("cookie"), index === 0);
    assert.equal(headers.has("x-test"), index === 0);
  }
});

test("JSON headers restored after cross-origin suppression obey the request header byte limit", async () => {
  let calls = 0;
  const result = await run(["-L", "--json", "{}", "-A", "a", "-H", "Content-Type:", "http://127.0.0.1/start"], { options: {
    authorize: () => true,
    limits: { maxHeaderBytes: 70 },
    transport: async () => {
      calls++;
      return calls === 1 ? { ...response(), status: 302, headers: [["Location", "http://a/"]] } : response();
    },
  } });
  assert.equal(result.exitCode, 63, result.stderr.toString());
  assert.match(result.stderr.toString(), /Request headers exceed host byte limit/);
  assert.equal(calls, 1);
});

test("denied URLs neither invoke transport nor consume uploads", async () => {
  let reads = 0; let calls = 0;
  const stdin = (async function* () { reads++; yield Buffer.from("secret"); })();
  const result = await run(["-T", "-", "http://127.0.0.1/"], { stdin,
    options: { authorize: () => false, transport: async () => { calls++; return response(); } },
  });
  assert.equal(result.exitCode, 7); assert.equal(reads, 0); assert.equal(calls, 0);
});

test("timeout covers authorization and observes late rejection", async () => {
  const result = await run(["-m", "0.01", "http://127.0.0.1/"], { options: {
    authorize: async () => { await sleep(30); throw new Error("private policy detail"); },
  } });
  assert.equal(result.exitCode, 28); await sleep(40);
  assert.doesNotMatch(result.stderr.toString(), /private policy/);
});

test("late transport responses are disposed after timeout", async () => {
  let disposed = 0;
  const result = await run(["-m", "0.01", "http://127.0.0.1/"], { options: {
    transport: async () => { await sleep(30); return { ...response(), async dispose() { disposed++; } }; },
  } });
  assert.equal(result.exitCode, 28); await sleep(40); assert.equal(disposed, 1);
});

test("pre-aborted commands perform no work", async () => {
  const controller = new AbortController(); controller.abort(new Error("stopped"));
  await assert.rejects(run(["http://127.0.0.1/"], { signal: controller.signal }), /stopped/);
});

test("external abort closes a streaming HTTP response", { timeout: 2000 }, async () => {
  const host = await server(); const controller = new AbortController();
  try {
    await assert.rejects(run([host.origin + "/stream"], { signal: controller.signal, stdout: {
      async write() { controller.abort(new Error("consumer canceled")); },
    } }), /consumer canceled/);
    await sleep(40); assert.equal(host.closedStreams, 1);
  } finally { await host.close(); }
});

test("downstream EPIPE closes request/body without a shell workaround", { timeout: 2000 }, async () => {
  const host = await server();
  try {
    const result = await run([host.origin + "/stream"], { stdout: { async write() { throw new FsError("EPIPE"); } } });
    assert.equal(result.exitCode, 23); await sleep(40); assert.equal(host.closedStreams, 1);
  } finally { await host.close(); }
});

test("total timeout closes a server that never sends headers", { timeout: 2000 }, async () => {
  const host = await server();
  try { const result = await run(["-m", "0.03", host.origin + "/slow"]); assert.equal(result.exitCode, 28); await sleep(30); assert.equal(host.closedStreams, 1); }
  finally { await host.close(); }
});

test("download quota stops stream and returns curl 63", async () => {
  const host = await server();
  try { const result = await run(["--max-filesize", "100", host.origin + "/stream"]); assert.equal(result.exitCode, 63); assert.equal(result.stdout.length, 0); await sleep(30); assert.equal(host.closedStreams, 1); }
  finally { await host.close(); }
});

test("upload quota stops bytes rather than truncating successfully", async () => {
  const host = await server();
  try { const result = await run(["-T", "-", host.origin + "/echo"], { stdin: "too large", options: { limits: { maxUploadBytes: 3 } } }); assert.equal(result.exitCode, 63); }
  finally { await host.close(); }
});

test("stdin replay overflow fails honestly instead of sending a prefix", async () => {
  const host = await server();
  try {
    const result = await run(["-L", "-T", "-", host.origin + "/redirect/307"], { stdin: Buffer.alloc(400, 97), options: { limits: { maxBufferBytes: 128 } } });
    assert.equal(result.exitCode, 65); assert.equal(host.requests.filter(request => request.path === "/echo").length, 0);
  } finally { await host.close(); }
});

test("output awaits sink pressure before pulling subsequent chunks", async () => {
  let produced = 0; let writes = 0; let disposed = 0;
  const source = (async function* () { for (let index = 0; index < 12; index++) { produced++; yield Buffer.from("x"); } })();
  const result = await run(["http://127.0.0.1/"], { stdout: { async write() { assert.equal(produced, ++writes); await sleep(1); } },
    options: { transport: async () => ({ ...response(source), async dispose() { disposed++; } }) },
  });
  assert.equal(result.exitCode, 0); assert.equal(writes, 12); assert.equal(disposed, 1);
});

test("producer throws and partial output cannot become success", async () => {
  const source = (async function* () { yield Buffer.from("prefix"); throw new Error("secret transport detail"); })();
  const result = await run(["http://127.0.0.1/"], { options: { transport: async () => response(source) } });
  assert.equal(result.exitCode, 56); assert.equal(result.stdout.toString(), "prefix"); assert.doesNotMatch(result.stderr.toString(), /secret/);
});

test("empty-chunk producers do not starve timeout cancellation", { timeout: 2000 }, async () => {
  const source = (async function* () { while (true) yield new Uint8Array(); })();
  const result = await run(["-m", "0.02", "http://127.0.0.1/"], { options: { transport: async () => response(source) } });
  assert.equal(result.exitCode, 28);
});

test("VFS output errors remain failure and dispose the response", async () => {
  const fs = await fixture(); let disposed = 0;
  fs.writeStream = async () => { throw new FsError("ENOSPC"); };
  const result = await run(["-o", "out", "http://127.0.0.1/"], { fs, options: { transport: async () => ({ ...response(), async dispose() { disposed++; } }) } });
  assert.equal(result.exitCode, 23); assert.equal(disposed, 1);
});

test("sensitive URL userinfo is absent from policy, transport and diagnostics", async () => {
  let seen = "";
  const result = await run(["-v", "http://user:secret@127.0.0.1/path"], { options: {
    authorize: request => { assert.doesNotMatch(request.url, /user|secret/); return true; },
    transport: async request => { seen = request.url; throw new Error("secret transport exception"); },
  } });
  assert.equal(seen, "http://127.0.0.1/path"); assert.equal(result.exitCode, 56); assert.doesNotMatch(result.stderr.toString(), /secret|dXNlcjpzZWNyZXQ=/);
});
