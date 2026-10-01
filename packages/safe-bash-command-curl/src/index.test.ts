import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createCurlCommand, createCurlCommands, curlCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", fs = createMemoryFileSystem()) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone curl works with only portable filesystem and command contracts", async () => {
  assert.equal(createCurlCommand().name, "curl");
  assert.ok(createCurlCommands().some(command => command.name === "curl"));
  assert.equal(curlCommands().name, "curl-commands");
  const result = await run(createCurlCommand(), ["--help"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.length > 0);
});

test("curl config nesting is unlimited by default and honors an explicit depth", async () => {
  const fs = createMemoryFileSystem();
  for (let depth = 0; depth < 20; depth++) {
    await fs.writeFile(`/config${depth}`, new TextEncoder().encode(depth === 19 ? "url https://example.test/data" : `config /config${depth + 1}`));
  }
  for (const maxConfigDepth of [Infinity, 16]) {
    let calls = 0;
    const command = createCurlCommand({ authorize: () => true, limits: { maxConfigDepth }, transport: async () => {
      calls++;
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), dispose: async () => {} };
    } });
    const result = await run(command, ["-K", "/config0"], "", fs);
    assert.equal(result.exitCode, maxConfigDepth === Infinity ? 0 : 2, result.stderr);
    assert.equal(calls, maxConfigDepth === Infinity ? 1 : 0);
  }
});

test("curl requires authorization before invoking an injected transport", async () => {
  let calls = 0;
  const command = createCurlCommand({ transport: async () => { calls++; throw new Error("unexpected transport"); } });
  const denied = await run(command, ["https://example.test/data"]);
  assert.notEqual(denied.exitCode, 0);
  assert.equal(calls, 0);
});

test("curl sends only the final user-agent and omits an explicitly empty agent", async () => {
  for (const agent of ["Agent2", ""]) {
    const headers: string[] = [];
    const command = createCurlCommand({ authorize: () => true, transport: async request => {
      headers.push(...request.headers.filter(([name]) => name.toLowerCase() === "user-agent").map(([, value]) => value));
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), dispose: async () => {} };
    } });
    const result = await run(command, ["-A", "Agent1", "-A", agent, "https://example.test/data"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(headers, agent ? [agent] : []);
  }
});

for (const exact of [false, true]) test(`curl selects ${exact ? "exact connection" : "response-header"} deadline capability`, async () => {
  let calls = 0;
  const transport = Object.assign(async (request: import("safe-bash-contracts/http").HttpRequest) => {
    calls++;
    assert.equal(request.connectTimeoutMs, exact ? 1000 : undefined);
    assert.equal(request.responseHeaderTimeoutMs, exact ? undefined : 1000);
    return { status: 200, statusText: "OK", headers: [], body: toByteSource("ok"), dispose: async () => {} };
  }, { supportsResponseHeaderTimeout: true as const, ...(exact ? { supportsConnectTimeout: true as const } : {}) });
  const result = await run(createCurlCommand({ authorize: () => true, transport }), ["--connect-timeout", "1", "https://example.test/"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "ok");
  assert.equal(calls, 1);
});

test("curl creates output parents and supplies cookie data", async () => {
 const fs = createMemoryFileSystem();
 const command = createCurlCommand({ authorize: () => true, transport: async request => {
  assert.ok(request.headers.some(([name, value]) => name.toLowerCase() === "cookie" && value === "session=abc"));
  return { status: 200, statusText: "OK", headers: [], body: toByteSource("download"), dispose: async () => {} };
 } });
 const result = await run(command, ["--create-dirs", "--output-dir", "/nested", "-o", "file", "-b", "session=abc", "https://example.test/"], "", fs);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(new TextDecoder().decode(await fs.readFile("/nested/file")), "download");
});

for (const flag of ["--retry-all-errors", "--retry-connrefused"]) test(`curl ${flag} retries connection refusal`, async () => {
 let calls = 0;
 const command = createCurlCommand({ authorize: () => true, transport: async () => {
  if (++calls === 1) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
  return { status: 200, statusText: "OK", headers: [], body: toByteSource("ok"), dispose: async () => {} };
 } });
 const result = await run(command, [flag, "--retry", "1", "--retry-delay", "0.001", "--retry-max-time", "1", "https://example.test/"]);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(calls, 2);
});

test("curl uses fetch with default unbounded limits", async t => {
 let calls = 0;
 t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("portable"); });
 const result = await run(createCurlCommand({ authorize: () => true }), ["https://example.test/"]);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(result.stdout, "portable");
 assert.equal(calls, 1);
});

test("curl forwards insecure only to an explicitly capable transport", async () => {
 for (const flag of ["-k", "--insecure"]) {
  let calls = 0;
  const transport = Object.assign(async (request: import("safe-bash-contracts/http").HttpRequest) => {
   calls++; assert.equal(request.insecure, true);
   return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), dispose: async () => {} };
  }, { supportsInsecureTls: true as const });
  assert.equal((await run(createCurlCommand({ authorize: () => true, transport }), [flag, "https://example.test/"])).exitCode, 0);
  assert.equal(calls, 1);
 }
 const rejected = await run(createCurlCommand({ authorize: () => true }), ["-k", "https://example.test/"]);
 assert.equal(rejected.exitCode, 2);
 assert.match(rejected.stderr, /cannot disable TLS/);
});

test("curl reads domain, path, secure and expiry scoped cookie files", async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/cookies", new TextEncoder().encode([
  "# Netscape HTTP Cookie File", "example.test\tFALSE\t/\tTRUE\t0\tsession\tabc",
  "other.test\tFALSE\t/\tFALSE\t0\twrong\tx", "example.test\tFALSE\t/\tFALSE\t1\texpired\tx",
  "example.test\tFALSE\t/private\tFALSE\t0\tprivate\tx",
 ].join("\n")));
 const command = createCurlCommand({ authorize: () => true, transport: async request => {
  assert.deepEqual(request.headers.filter(([name]) => name === "Cookie"), [["Cookie", "session=abc"]]);
  return { status: 200, statusText: "OK", headers: [], body: toByteSource("ok"), dispose: async () => {} };
 } });
 const result = await run(command, ["--cookie", "/cookies", "https://example.test/"], "", fs);
 assert.equal(result.exitCode, 0, result.stderr);
});

test("retry-max-time prevents a retry whose delay exceeds the budget", async () => {
 let calls = 0;
 const command = createCurlCommand({ authorize: () => true, transport: async () => {
  calls++; throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
 } });
 const result = await run(command, ["--retry-all-errors", "--retry", "5", "--retry-delay", "2", "--retry-max-time", "1", "https://example.test/"]);
 assert.notEqual(result.exitCode, 0);
 assert.equal(calls, 1);
});

test("literal cookies are removed across origins while each hop is authorized", async () => {
 const visits: string[] = [];
 const command = createCurlCommand({ authorize: request => { visits.push(request.url); return true; }, transport: async request => {
  const initial = new URL(request.url).hostname === "example.test";
  assert.equal(request.headers.some(([name]) => name === "Cookie"), initial);
  return { status: initial ? 302 : 200, statusText: "OK", headers: initial ? [["Location", "https://other.test/"]] : [], body: toByteSource(""), dispose: async () => {} };
 } });
 const result = await run(command, ["-L", "-b", "secret=abc", "https://example.test/"]);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.deepEqual(visits, ["https://example.test/", "https://other.test/"]);
});

for (const failure of ["http", "body"]) test(`retry-all-errors recovers from ${failure} errors`, async () => {
 let calls = 0;
 const command = createCurlCommand({ authorize: () => true, transport: async () => {
  const failed = ++calls === 1;
  return { status: failed && failure === "http" ? 404 : 200, statusText: "OK", headers: [],
   body: failed && failure === "body" ? (async function* () { yield new Uint8Array(); throw new Error("body interrupted"); })() : toByteSource("ok"), dispose: async () => {} };
 } });
 const result = await run(command, ["--retry-all-errors", "--retry", "1", "--retry-delay", "0.001", "--fail", "https://example.test/"]);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(calls, 2);
 assert.equal(result.stdout, "ok");
});

test("retry time exhaustion preserves the last response file", async () => {
 const fs = createMemoryFileSystem();
 let calls = 0;
 const command = createCurlCommand({ authorize: () => true, transport: async () => {
  calls++;
  return { status: 503, statusText: "Unavailable", headers: [], body: toByteSource("unavailable"), dispose: async () => {} };
 } });
 const result = await run(command, ["--retry", "1", "--retry-delay", "2", "--retry-max-time", "1", "-o", "/response", "https://example.test/"], "", fs);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.equal(calls, 1);
 assert.equal(new TextDecoder().decode(await fs.readFile("/response")), "unavailable");
});
