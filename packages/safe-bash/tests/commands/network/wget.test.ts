import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createNodeHttpTransport, networkCommands, type HttpTransport, type NetworkCommandsOptions } from "../../../src/commands/network/index.js";
import { collectBytes, toByteSource } from "../../../src/contracts/index.js";
import { server } from "./helpers.js";

async function fixture(options: Partial<NetworkCommandsOptions> = {}) {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  const requests: string[] = [];
  const transport: HttpTransport = async request => {
    requests.push(request.url);
    return { status: 200, statusText: 'OK', headers: [], body: toByteSource(Uint8Array.of(0, 255, 97)), async dispose() {} };
  };
  const shell = new Shell({ fs, cwd: '/work' }).use(networkCommands({ authorize: () => true, transport, ...options }));
  return { shell, fs, requests };
}

for (const flag of ['--spider', '--continue', '--no-clobber', '--directory-prefix=sub', '--input-file=urls.txt', '--content-disposition', '-T2 -t1']) {
  test(`wget download controls: ${flag}`, async () => {
    const { shell, fs, requests } = await fixture();
    await fs.writeFile('/work/urls.txt', new TextEncoder().encode('https://example.test/file.bin\n'));
    try {
      const result = await shell.exec(`wget -q ${flag} ${flag.includes('input-file') ? '' : 'https://example.test/file.bin'}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(requests.length, 1);
      if (flag === '--spider') await assert.rejects(fs.stat('/work/file.bin'), { code: 'ENOENT' });
      else assert.deepEqual([...await fs.readFile(flag.includes('directory') ? '/work/sub/file.bin' : '/work/file.bin')], [0, 255, 97]);
    } finally { await shell.dispose(); }
  });
}

test('wget no-clobber skips existing files without network access', async () => {
  const { shell, fs, requests } = await fixture();
  await fs.writeFile('/work/file.bin', Uint8Array.of(7));
  try {
    assert.equal((await shell.exec('wget -nc https://example.test/file.bin')).exitCode, 0);
    assert.deepEqual([...await fs.readFile('/work/file.bin')], [7]);
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});

for (const partial of [true, false]) test(`wget resumes with server range support=${partial}`, async () => {
  const { shell, fs } = await fixture({ transport: async request => {
    assert.ok(request.headers.some(([name, value]) => name === 'Range' && value === 'bytes=2-'));
    return { status: partial ? 206 : 200, statusText: 'OK', headers: partial ? [['Content-Range', 'bytes 2-3/4']] : [],
      body: toByteSource(partial ? 'cd' : 'abcd'), async dispose() {} };
  } });
  await fs.writeFile('/work/file', new TextEncoder().encode('ab'));
  try {
    assert.equal((await shell.exec('wget -c https://example.test/file')).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile('/work/file')), 'abcd');
  } finally { await shell.dispose(); }
});

test('wget input lists download multiple URLs with safe content-disposition names', async () => {
  const { shell, fs } = await fixture({ transport: async request => ({ status: 200, statusText: 'OK',
    headers: [['Content-Disposition', `attachment; filename="../${new URL(request.url).pathname.slice(1)}.txt"`]],
    body: toByteSource('ok'), async dispose() {} }) });
  await fs.writeFile('/work/urls', new TextEncoder().encode('https://example.test/a\nhttps://example.test/b\n'));
  try {
    const result = await shell.exec('wget -i urls -P sub --content-disposition');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile('/work/sub/a.txt')), 'ok');
    assert.equal(new TextDecoder().decode(await fs.readFile('/work/sub/b.txt')), 'ok');
  } finally { await shell.dispose(); }
});

test('wget refuses incorrect resume ranges without changing the existing file', async () => {
  const { shell, fs } = await fixture({ transport: async () => ({ status: 206, statusText: 'OK',
    headers: [['Content-Range', 'bytes 1-3/4']], body: toByteSource('bcd'), async dispose() {} }) });
  await fs.writeFile('/work/file', new TextEncoder().encode('ab'));
  try {
    assert.equal((await shell.exec('wget -c https://example.test/file')).exitCode, 4);
    assert.equal(new TextDecoder().decode(await fs.readFile('/work/file')), 'ab');
  } finally { await shell.dispose(); }
});

test('wget input lists enforce URL and buffer limits before transferring', async () => {
  const { shell, fs, requests } = await fixture({ limits: { maxUrls: 1, maxBufferBytes: 128 } });
  await fs.writeFile('/work/urls', new TextEncoder().encode('https://example.test/a\nhttps://example.test/b\n'));
  await fs.writeFile('/work/large', new Uint8Array(129));
  try {
    assert.equal((await shell.exec('wget -i urls')).exitCode, 2);
    assert.equal((await shell.exec('wget -i large')).exitCode, 3);
    assert.equal((await shell.exec('wget -i missing')).exitCode, 3);
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});

test('wget reads URL lists from stdin and checks spider HTTP failures without output', async () => {
  const { shell } = await fixture({ transport: async request => {
    assert.equal(request.method, 'HEAD');
    assert.equal(request.responseBodyMode, 'omit');
    return { status: 404, statusText: 'Not Found', headers: [], body: toByteSource('discard'), async dispose() {} };
  } });
  try {
    const result = await shell.exec("wget --spider -i -", { stdin: 'https://example.test/a\n' });
    assert.equal(result.exitCode, 8);
    assert.equal(result.stdout, '');
  } finally { await shell.dispose(); }
});

for (const [options, expected] of [
  ['--header="X-Test: hello"', { 'x-test': 'hello' }],
  ["--header 'X-Test: hello' --header 'X-Other: world'", { 'x-test': 'hello', 'x-other': 'world' }],
  ["--header 'X-Test: first' --header 'x-test: last'", { 'x-test': 'last' }],
  ["--header 'X-Test: first' --header= --header 'X-Other: last'", { 'x-other': 'last' }],
  ["--header 'Accept:'", { accept: '' }],
  ['--user-agent=AUDIT --referer=https://example.invalid/a', { 'user-agent': 'AUDIT', referer: 'https://example.invalid/a' }],
  ["--user-agent first --user-agent last --referer first --referer last", { 'user-agent': 'last', referer: 'last' }],
  ["--user-agent=AUDIT --referer=source --header 'X-Test: first' --header=", { 'user-agent': 'AUDIT', referer: 'source' }],
  ["--header 'User-Agent: custom' --user-agent=AUDIT --header 'Referer: custom' --referer=source", { 'user-agent': 'custom', referer: 'custom' }],
  ['--user-agent= --referer=', { 'user-agent': undefined, referer: '' }],
] as const) test(`wget sends request headers over HTTP: ${options}`, async () => {
  const endpoint = await server();
  const { shell } = await fixture({ transport: createNodeHttpTransport() });
  try {
    const result = await shell.exec(`wget -q -O - ${options} ${endpoint.origin}/hello`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).path, '/hello');
    assert.equal(endpoint.requests.length, 1);
    const headers = endpoint.requests[0]!.headers;
    for (const [name, value] of Object.entries(expected)) assert.equal(headers[name], value);
    if (!Object.hasOwn(expected, 'x-test')) assert.equal(headers['x-test'], undefined);
  } finally { await shell.dispose(); await endpoint.close(); }
});

for (const options of [
  '--header', '--user-agent', '--referer', '--header=invalid', '--header=X-Test;',
  "--header 'Bad Name: value'", "--header $'X-Test: value\\r\\nX-Injected: bad'",
  "--user-agent $'value\\r\\nX-Injected: bad'", "--referer $'value\\nX-Injected: bad'",
  ...['Host', 'Content-Length', 'Transfer-Encoding', 'Connection', 'Proxy-Authorization', 'Upgrade', 'Expect']
    .map(name => `--header '${name}: value'`),
]) test(`wget rejects invalid request headers before authorization: ${options}`, async () => {
  let authorizations = 0;
  const { shell, requests } = await fixture({ authorize: () => { authorizations++; return true; } });
  try {
    const result = await shell.exec(`wget -O- https://example.test/hello ${options}`);
    assert.equal(result.exitCode, 2);
    assert.equal(authorizations, 0);
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});

test('wget drops custom headers after a cross-origin redirect', async () => {
  const seen: { url: string; headers: readonly (readonly [string, string])[] }[] = [];
  const authorized: string[] = [];
  const { shell } = await fixture({
    authorize: request => { authorized.push(request.url); return true; },
    transport: async request => {
      seen.push({ url: request.url, headers: request.headers });
      return seen.length === 1
        ? { status: 302, statusText: 'Found', headers: [['Location', 'https://other.test/end']], body: toByteSource(''), async dispose() {} }
        : { status: 200, statusText: 'OK', headers: [], body: toByteSource('hello'), async dispose() {} };
    },
  });
  try {
    const result = await shell.exec("wget -qO- --header 'Authorization: synthetic' --header 'X-Test: hello' https://example.test/start");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'hello');
    assert.deepEqual(authorized, ['https://example.test/start', 'https://other.test/end']);
    assert.ok(seen[0]!.headers.some(([name, value]) => name === 'Authorization' && value === 'synthetic'));
    assert.equal(seen[1]!.headers.some(([name]) => ['authorization', 'x-test'].includes(name.toLowerCase())), false);
  } finally { await shell.dispose(); }
});

test('wget request headers retain the host byte ceiling', async () => {
  const { shell, requests } = await fixture({ limits: { maxHeaderBytes: 128 } });
  try {
    const result = await shell.exec(`wget -O- --header 'X-Test: ${'a'.repeat(128)}' https://example.test/hello`);
    assert.equal(result.exitCode, 4);
    assert.ok(result.stderr.includes('Request headers exceed host byte limit'));
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});

for (const [options, method, body] of [
  ['--post-data=a=b', 'POST', 'a=b'],
  ["--post-data '@input'", 'POST', '@input'],
  ["--post-data ''", 'POST', ''],
  ['--post-data=a --post-data=b', 'POST', 'b'],
  ['--method=put --body-data=SYNTHETIC', 'PUT', 'SYNTHETIC'],
  ["--method POST --body-data '@input'", 'POST', '@input'],
  ['--method=DELETE', 'DELETE', undefined],
] as const) test(`wget request data: ${options}`, async () => {
  const seen: { method: string; body: string | undefined; contentType: string | undefined }[] = [];
  const authorized: string[] = [];
  const { shell } = await fixture({
    authorize: request => { authorized.push(request.method); return true; },
    transport: async request => {
      seen.push({ method: request.method, body: request.body ? new TextDecoder().decode(await collectBytes(request.body, { maxBytes: 1024 })) : undefined,
        contentType: request.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] });
      return { status: 200, statusText: 'OK', headers: [], body: toByteSource('response'), async dispose() {} };
    },
  });
  try {
    const result = await shell.exec(`wget -qO- ${options} https://example.test/echo`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, 'response');
    assert.deepEqual(authorized, [method]);
    assert.deepEqual(seen, [{ method, body, contentType: body === undefined ? undefined : 'application/x-www-form-urlencoded' }]);
  } finally { await shell.dispose(); }
});

for (const options of ['--post-file=input', '--post-file input', '--method=PUT --body-file=input', '--method PUT --body-file input', '--post-file=-']) {
  test(`wget sends virtual file bytes over HTTP: ${options}`, async () => {
    const endpoint = await server();
    const { shell, fs } = await fixture({ transport: createNodeHttpTransport() });
    const bytes = Uint8Array.of(0, 255, 97, 13, 10, 128);
    await fs.writeFile('/work/input', bytes);
    await fs.writeFile('/work/-', bytes);
    try {
      const result = await shell.exec(`wget -qO- ${options} ${endpoint.origin}/echo`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(endpoint.requests.length, 1);
      assert.equal(endpoint.requests[0]!.method, options.includes('--method') ? 'PUT' : 'POST');
      assert.deepEqual([...endpoint.requests[0]!.body], [...bytes]);
      assert.equal(endpoint.requests[0]!.headers['content-type'], 'application/x-www-form-urlencoded');
    } finally { await shell.dispose(); await endpoint.close(); }
  });
}

test('wget request bodies retain upload limits and authorization', async () => {
  let calls = 0;
  const { shell, fs } = await fixture({ limits: { maxUploadBytes: 2 },
    transport: async request => {
      calls++;
      if (request.body) await collectBytes(request.body, { maxBytes: 1024 });
      return { status: 200, statusText: 'OK', headers: [], body: toByteSource(''), async dispose() {} };
    },
  });
  await fs.writeFile('/work/input', new TextEncoder().encode('abc'));
  try {
    for (const options of ['--post-data=abc', '--post-file=input']) {
      const result = await shell.exec(`wget --tries=1 -O- ${options} https://example.test/echo`);
      assert.equal(result.exitCode, 4);
      assert.match(result.stderr, /host byte limit/u);
    }
    assert.equal(calls, 2);
  } finally { await shell.dispose(); }

  const denied = await fixture({ authorize: () => false });
  try {
    assert.equal((await denied.shell.exec('wget -qO- --post-data=a=b https://example.test/echo')).exitCode, 4);
    assert.equal(denied.requests.length, 0);
  } finally { await denied.shell.dispose(); }
});

test('wget reports virtual request-file errors', async () => {
  const { shell } = await fixture({ transport: async request => {
    if (request.body) await collectBytes(request.body, { maxBytes: 1024 });
    throw new Error('Expected a missing file failure');
  } });
  try {
    const result = await shell.exec('wget --tries=1 -O- --post-file=missing https://example.test/echo');
    assert.equal(result.exitCode, 3);
    assert.match(result.stderr, /Failed to read virtual upload file/u);
  } finally { await shell.dispose(); }
});

for (const options of ['--body-data=a', '--post-data=a --method=PUT', '--post-data=a --post-file=input',
  '--method=PUT --body-data=a --body-file=input', '--method=', '--method=CONNECT', "--method 'bad method'", '--post-file=']) {
  test(`wget refuses invalid request options before network: ${options}`, async () => {
    const { shell, requests } = await fixture();
    try {
      assert.equal((await shell.exec(`wget -qO- ${options} https://example.test/echo`)).exitCode, 2);
      assert.equal(requests.length, 0);
    } finally { await shell.dispose(); }
  });
}

for (const [args, path] of [
  ['https://example.test/file.bin', '/work/file.bin'],
  ['-O result https://example.test/file.bin', '/work/result'],
  ['-q -O- https://example.test/file.bin', undefined],
  ['-nv --timeout=2 --tries=1 -O- https://example.test/file.bin', undefined],
] as const) test(`wget downloads bytes: ${args}`, async () => {
  const { shell, fs, requests } = await fixture();
  try {
    const result = await shell.exec(`wget ${args}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual([...path ? await fs.readFile(path) : result.stdoutBytes], [0, 255, 97]);
    assert.equal(requests.length, 1);
  } finally { await shell.dispose(); }
});

test('wget rejects recursive mirroring before requesting', async () => {
  const { shell, requests } = await fixture();
  try {
    const result = await shell.exec('wget -r https://example.test/file');
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /recursive.*unsupported/iu);
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});

test('wget reauthorizes redirects before transport', async () => {
  const seen: string[] = [];
  let requests = 0;
  const { shell } = await fixture({
    authorize: request => { seen.push(request.url); return seen.length === 1; },
    transport: async () => { requests++; return { status: 302, statusText: 'Found', headers: [['Location', 'https://denied.test/end']], body: toByteSource(''), async dispose() {} }; },
  });
  try {
    const result = await shell.exec('wget --tries=1 -O- https://example.test/start');
    assert.equal(result.exitCode, 4);
    assert.deepEqual(seen, ['https://example.test/start', 'https://denied.test/end']);
    assert.equal(requests, 1);
  } finally { await shell.dispose(); }
});

test('network plugin preflights wget conflicts without partially installing curl', async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register({ name: 'wget', execute() { return { exitCode: 0 }; } });
  try {
    await assert.rejects(async () => networkCommands({ authorize: () => true }).setup(shell), /already registered/u);
    assert.equal(shell.commands.has('curl'), false);
  } finally { await shell.dispose(); }
});

for (const quiet of [false, true]) test(`wget server failure quiet=${quiet}`, async () => {
  const { shell } = await fixture({ transport: async () => ({ status: 404, statusText: 'Not Found', headers: [], body: toByteSource('secret'), async dispose() {} }) });
  try {
    const result = await shell.exec(`wget ${quiet ? '-q' : '-nv'} -O- https://example.test/no`);
    assert.equal(result.exitCode, 8);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.length > 0, !quiet);
  } finally { await shell.dispose(); }
});

test('wget refuses invalid UTF8 arguments before touching the network', async () => {
  const { shell, requests } = await fixture();
  try {
    const result = await shell.exec('wget -O $\'\\377\' https://example.test/file');
    assert.equal(result.exitCode, 2);
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});

for (const tries of [1, 2, 0]) test(`wget total tries ${tries} obeys the host retry ceiling`, async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const attempts: number[] = [];
  let disposed = 0;
  const { shell } = await fixture({ limits: { maxRetries: 1 }, authorize: request => { attempts.push(request.attempt); return true; }, transport: async () => ({ status: 503, statusText: 'Unavailable', headers: [], body: toByteSource(''), async dispose() { disposed++; } }) });
  try {
    const execution = shell.exec(`wget -q --tries=${tries} -O- https://example.test/file`);
    for (let turn = 0; !disposed && turn < 100; turn++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(disposed);
    if (tries !== 1) {
      for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      context.mock.timers.tick(1000);
    }
    assert.equal((await execution).exitCode, 8);
    assert.deepEqual(attempts, tries === 1 ? [0] : [0, 1]);
  } finally { await shell.dispose(); }
});

test('wget accepts combined quiet and output flags', async () => {
  const { shell } = await fixture();
  try {
    const result = await shell.exec('wget -qO- https://example.test/file');
    assert.equal(result.exitCode, 0);
    assert.deepEqual([...result.stdoutBytes], [0, 255, 97]);
    assert.equal(result.stderr, '');
  } finally { await shell.dispose(); }
});

test('wget refuses transports unable to enforce required private-network policy', async () => {
  const { shell, requests } = await fixture({ authorize: request => { request.requirePrivateNetworkDeny?.(); return true; } });
  try {
    assert.equal((await shell.exec('wget -O- https://example.test/file')).exitCode, 4);
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});

test('wget retains the host download-byte cap', async () => {
  const { shell } = await fixture({ limits: { maxDownloadBytes: 2 } });
  try {
    const result = await shell.exec('wget -O- https://example.test/file');
    assert.equal(result.exitCode, 4);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /download byte limit/u);
  } finally { await shell.dispose(); }
});

for (const code of ['ECONNRESET', 'ECONNREFUSED']) test(`wget acquisition retry classification ${code}`, async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const attempts: number[] = [];
  let calls = 0;
  const { shell } = await fixture({ limits: { maxRetries: 1 }, authorize: request => { attempts.push(request.attempt); return true; }, transport: async () => {
    if (++calls === 1) throw Object.assign(new Error('transport'), { code });
    return { status: 200, statusText: 'OK', headers: [], body: toByteSource('recovered'), async dispose() {} };
  } });
  try {
    const execution = shell.exec('wget --tries=2 -O- https://example.test/file');
    for (let turn = 0; !calls && turn < 100; turn++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    context.mock.timers.tick(1000);
    const result = await execution;
    assert.equal(result.exitCode, code === 'ECONNRESET' ? 0 : 4);
    assert.equal(result.stdout, code === 'ECONNRESET' ? 'recovered' : '');
    assert.deepEqual(attempts, code === 'ECONNRESET' ? [0, 1] : [0]);
  } finally { await shell.dispose(); }
});

for (const name of ['\ud800', '\udfff', '\ufffd', '\ufefffile']) test(`wget SDK filename UTF8 identity ${JSON.stringify(name)}`, async () => {
  const { shell, fs, requests } = await fixture();
  shell.register({ name: 'invoke', execute: context => context.invoke!('wget', ['-O', name, 'https://example.test/file']) });
  try {
    const result = await shell.exec('invoke');
    const invalid = name === '\ud800' || name === '\udfff';
    assert.equal(result.exitCode, invalid ? 2 : 0);
    assert.equal(requests.length, invalid ? 0 : 1);
    if (!invalid) assert.deepEqual([...await fs.readFile(`/work/${name}`)], [0, 255, 97]);
  } finally { await shell.dispose(); }
});

test('shared transfer rejects aliased body and header output paths before network', async () => {
  const { shell, requests } = await fixture();
  try {
    const result = await shell.exec('curl -o ./result -D result https://example.test/file');
    assert.equal(result.exitCode, 23);
    assert.match(result.stderr, /must differ/u);
    assert.equal(requests.length, 0);
  } finally { await shell.dispose(); }
});
