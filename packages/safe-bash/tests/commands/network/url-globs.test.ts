import assert from "node:assert/strict";
import { test } from "node:test";
import { toByteSource } from "../../../src/contracts/index.js";
import { Shell } from "../../../src/index.js";
import { networkCommands } from "../../../src/commands/network/index.js";
import { fixture, run } from "./helpers.js";

const origin = "http://127.0.0.1";

for (const [pattern, paths] of [
  ["/{left,right}", ["/left", "/right"]],
  ["/item[3-5]", ["/item3", "/item4", "/item5"]],
  ["/item[03-05]", ["/item03", "/item04", "/item05"]],
  ["/item[x-z]", ["/itemx", "/itemy", "/itemz"]],
  ["/item[2-6:2]", ["/item2", "/item4", "/item6"]],
  ["/item[a-e:2]", ["/itema", "/itemc", "/iteme"]],
  ["/?owned=[3-5]", ["/?owned=3", "/?owned=4", "/?owned=5"]],
  ["/{left,right}/item[3-4]", ["/left/item3", "/left/item4", "/right/item3", "/right/item4"]],
] as const) test(`curl expands ${pattern} before URL parsing and preserves response bytes`, async () => {
  const visits: string[] = [];
  const requests: string[] = [];
  const result = await run(["-sS", `${origin}${pattern}`], { options: {
    authorize(request) { visits.push(request.url); return true; },
    async transport(request) {
      requests.push(request.url);
      return { status: 200, statusText: "OK", headers: [],
        body: toByteSource(Buffer.concat([Buffer.from(request.url), Buffer.from([255, 10])])), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(visits, paths.map(path => origin + path));
  assert.deepEqual(requests, visits);
  assert.deepEqual(result.stdout, Buffer.concat(visits.map(url => Buffer.concat([Buffer.from(url), Buffer.from([255, 10])]))));
});

test("curl substitutes captures in VFS output filenames", async () => {
  const result = await run(["-o", "piece-#1-#2", `${origin}/{left,right}/[03-04]`], { options: {
    async transport(request) {
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(Buffer.from([255, ...Buffer.from(request.url)])), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.length, 0);
  for (const word of ["left", "right"]) for (const number of ["03", "04"]) {
    assert.deepEqual(Buffer.from(await result.fs.readFile(`/work/piece-${word}-${number}`)), Buffer.from([255, ...Buffer.from(`${origin}/${word}/${number}`)]));
  }
  await assert.rejects(result.fs.stat("/work/piece-#1-#2"), { code: "ENOENT" });
});

test("curl authorizes each expanded target and never transports a denied target", async () => {
  const visits: string[] = [];
  const requests: string[] = [];
  const result = await run([`${origin}/{allowed,denied}`], { options: {
    authorize(request) { visits.push(request.url); return request.url.endsWith("/allowed"); },
    async transport(request) {
      requests.push(request.url);
      return { status: 200, statusText: "OK", headers: [], body: toByteSource("ok"), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 7);
  assert.deepEqual(visits, [`${origin}/allowed`, `${origin}/denied`]);
  assert.deepEqual(requests, [`${origin}/allowed`]);
});

for (const pattern of ["/[1-1000000000]", "/{a,b}/[1-3]", "/[0-9007199254740992]"]) {
  test(`curl bounds expanded URL count before requests: ${pattern}`, async () => {
    let calls = 0;
    const result = await run([`${origin}${pattern}`], { options: {
      limits: { maxUrls: 4 }, authorize() { calls++; return true; },
    } });
    assert.notEqual(result.exitCode, 0);
    assert.equal(calls, 0);
  });
}

test("curl bounds aggregate expanded URL bytes before requests", async () => {
  let calls = 0;
  const result = await run([`${origin}/${"x".repeat(80)}[1-4]`], { options: {
    limits: { maxBufferBytes: 200 }, authorize() { calls++; return true; },
  } });
  assert.notEqual(result.exitCode, 0);
  assert.equal(calls, 0);
});

test("curl bounds padded range materialization before requests", async () => {
  let calls = 0;
  const result = await run([`${origin}/[${"0".repeat(80)}-9]`], { options: {
    limits: { maxBufferBytes: 200 }, authorize() { calls++; return true; },
  } });
  assert.notEqual(result.exitCode, 0);
  assert.equal(calls, 0);
});

test("curl keeps ordinary URLs valid at the exact argument buffer boundary", async () => {
  const url = `${origin}/plain`;
  const result = await run([url], { options: {
    limits: { maxBufferBytes: Buffer.byteLength(url) },
    async transport() {
      return { status: 200, statusText: "OK", headers: [], body: toByteSource("ok"), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "ok");
});

test("curl applies the URL count limit across all patterns and explicit URLs", async () => {
  let calls = 0;
  const result = await run([`${origin}/{a,b}`, `${origin}/[1-2]`, `${origin}/plain`], { options: {
    limits: { maxUrls: 4 }, authorize() { calls++; return true; },
  } });
  assert.equal(result.exitCode, 2);
  assert.equal(calls, 0);
});

for (const pattern of ["/[3-1]", "/[1-2:0]", "/[1-2:9]", "/[a-Z]", "/[1-]", "/{}", "/{a,{b,c}}", "/{a,b", "/[1-2", "/a]", "/a}"]) {
  test(`malformed curl glob fails before requests: ${pattern}`, async () => {
    let calls = 0;
    const result = await run([`${origin}${pattern}`], { options: { authorize() { calls++; return true; } } });
    assert.equal(result.exitCode, 3);
    assert.equal(calls, 0);
  });
}

test("curl bounds work for long sequences of singleton captures", async () => {
  let calls = 0;
  const result = await run([`${origin}/${"{a}".repeat(1000)}`], { options: {
    limits: { maxUrls: 1_000_000, maxBufferBytes: 4000 }, authorize() { calls++; return true; },
  } });
  assert.notEqual(result.exitCode, 0);
  assert.equal(calls, 0);
});

test("curl glob transfers append all response headers to one dump file", async () => {
  const result = await run(["-D", "headers", `${origin}/{left,right}`], { options: {
    async transport(request) {
      return { status: 200, statusText: "OK", headers: [["X-Target", request.url]], body: toByteSource("ok"), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(Buffer.from(await result.fs.readFile("/work/headers")).toString(),
    `HTTP/1.1 200 OK\r\nX-Target: ${origin}/left\r\n\r\nHTTP/1.1 200 OK\r\nX-Target: ${origin}/right\r\n\r\n`);
});

test("quoted curl globs work through the actual Shell with constant output names", async () => {
  const requests: string[] = [];
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({
    authorize: () => true,
    async transport(request) {
      requests.push(request.url);
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(request.url), async dispose() {} };
    },
  }));
  const result = await shell.exec(`curl -o piece '${origin}/{left,right}'`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/work/piece")).toString(), `${origin}/right`);
  assert.deepEqual(requests, [`${origin}/left`, `${origin}/right`]);
});

for (const [args, expected] of [
  [["-g", `${origin}/{left,right}`], `${origin}/{left,right}`],
  [[`${origin}/%7Bleft,right%7D`], `${origin}/%7Bleft,right%7D`],
  [["http://[::1]/[1-2]"], "http://[::1]/1"],
] as const) test(`literal escapes and IPv6 remain valid: ${args.join(" ")}`, async () => {
  const requests: string[] = [];
  const result = await run(args, { options: {
    authorize: () => true,
    async transport(request) {
      requests.push(request.url);
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(requests[0], expected);
  assert.equal(requests.length, args[0]?.includes("[::1]") ? 2 : 1);
});
