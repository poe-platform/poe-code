import assert from "node:assert/strict";
import { test } from "node:test";
import { createFetchTransport } from "../../../src/commands/network/index.js";
import { run } from "./helpers.js";

for (const path of ['/changed/{left,right}', '/changed/left\\right', '/changed/%2E%2E/end', '/changed/%2e/end', '/changed/%2E./end', '/changed/"left"', '/changed/<left>', '/changed/`left`', '/changed/%7Bleft%7D', '/changed/%5C/end', '/changed/%20/end', '/changed/./end', '/changed/../end']) {
  test(`curl globoff preserves request URL ${path}`, async () => {
    const expected = path === '/changed/./end' ? '/changed/end' : path === '/changed/../end' ? '/end' : path;
    const urls: string[] = [];
    const result = await run(['-sS', '-g', `http://127.0.0.1${path}`], { options: {
      authorize(request) { urls.push(request.url); return true; },
      async transport(request) {
        urls.push(request.url);
        return { status: 200, statusText: 'OK', headers: [], body: (async function* () {})(), async dispose() {} };
      },
    } });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.deepEqual(urls, [`http://127.0.0.1${expected}`, `http://127.0.0.1${expected}`]);
  });
}

for (const location of ['/next/%2E%2E/{item}', '../%2e/<item>', 'http://other.example/next/left\\right']) {
  test(`curl preserves redirect target and authorizes each hop: ${location}`, async () => {
    const authorized: string[] = [];
    const sent: string[] = [];
    const result = await run(['-sS', '-g', '-L', 'http://127.0.0.1/start/{item}'], { options: {
      authorize(request) { authorized.push(request.url); return true; },
      async transport(request) {
        sent.push(request.url);
        return { status: sent.length === 1 ? 302 : 200, statusText: 'OK',
          headers: sent.length === 1 ? [['location', location]] : [],
          body: (async function* () {})(), async dispose() {} };
      },
    } });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const expected = location.startsWith('http:') ? location : location.startsWith('/')
      ? `http://127.0.0.1${location}` : 'http://127.0.0.1/%2e/<item>';
    assert.deepEqual(sent, ['http://127.0.0.1/start/{item}', expected]);
    assert.deepEqual(authorized, sent);
  });
}

test('curl preserves literal path when appending query data', async () => {
  let sent = '';
  const result = await run(['-sS', '-g', '--url-query', 'name=a b', 'http://127.0.0.1/{item}?raw=%2E'], { options: {
    async transport(request) {
      sent = request.url;
      return { status: 200, statusText: 'OK', headers: [], body: (async function* () {})(), async dispose() {} };
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(sent, 'http://127.0.0.1/{item}?raw=%2E&name=a+b');
});


test('Fetch refuses targets it would rewrite before making a request', async () => {
  const result = await run(['-sS', '-g', 'http://127.0.0.1/%2E/{item}'], { options: {
    transport: createFetchTransport({ fetch: async () => { throw new Error('must not fetch'); } }),
  } });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /cannot preserve the literal request target/);
});
