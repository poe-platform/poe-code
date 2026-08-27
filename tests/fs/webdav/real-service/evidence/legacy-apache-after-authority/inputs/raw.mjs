import assert from 'node:assert/strict';
import { request } from 'node:https';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [workspace, evidence] = process.argv.slice(2);
const { port } = JSON.parse(await readFile(`${workspace}/ready.json`, 'utf8'));
const ca = await readFile(`${workspace}/cert.pem`);
const base = `https://127.0.0.1:${port}/dav`;
const authorization = `Basic ${Buffer.from('fixture:fixture-only-password').toString('base64')}`;
const events = [];
async function wire(method, path, headers = {}, data = '') {
  const bytes = Buffer.from(data);
  const result = await new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, ca, agent: false, headers: {
      Authorization: authorization, 'Content-Length': bytes.length, ...headers,
    }, signal: AbortSignal.timeout(10000) }, async response => {
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of response) { size += chunk.length; assert.ok(size < 4 * 1024 * 1024); chunks.push(chunk); }
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() });
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
    req.end(bytes);
  });
  events.push({ method, path, requestHeaders: headers, requestBody: bytes.toString(), ...result });
  return result;
}
const rows = [];
async function row(name, kind, operation) {
  const start = events.length;
  try { await operation(); rows.push({ name, kind, result: 'pass', events: [start, events.length] }); }
  catch (error) { rows.push({ name, kind, result: 'fail', error: String(error), events: [start, events.length] }); }
  const paths = new Set();
  for (const event of events.slice(start)) {
    paths.add(event.path);
    const destination = event.requestHeaders.Destination;
    if (destination) {
      assert.ok(destination.startsWith(`${base}/`));
      paths.add(destination.slice(base.length));
    }
  }
  const witnessStart = events.length;
  const witnessErrors = [];
  for (const path of paths) {
    try {
      if (path !== '/') await get(path);
      await wire('PROPFIND', path, { Depth: '0', 'Content-Type': 'application/xml' }, '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>');
    } catch (error) { witnessErrors.push({ path, error: String(error) }); }
  }
  rows.at(-1).witnessEvents = [witnessStart, events.length];
  rows.at(-1).witnessErrors = witnessErrors;
  const witnesses = {};
  for (const entry of await readdir(`${workspace}/root`, { withFileTypes: true })) {
    if (entry.isFile()) witnesses[entry.name] = (await readFile(`${workspace}/root/${entry.name}`)).toString('base64');
  }
  rows.at(-1).hostWitnessesBase64 = witnesses;
}
const status = (result, expected) => assert.equal(result.status, expected);
const put = (path, body) => wire('PUT', path, {}, body);
const get = path => wire('GET', path);
async function stableGet(path) {
  let response = await get(path);
  if (response.headers.etag?.startsWith('W/')) {
    await new Promise(resolve => setTimeout(resolve, 2100));
    response = await get(path);
  }
  assert.match(response.headers.etag, /^"[^\"]*"$/);
  return response;
}
async function propEtag(path) {
  let response = await wire('PROPFIND', path, { Depth: '0', 'Content-Type': 'application/xml' }, '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>');
  if (response.body.includes('W/')) {
    await new Promise(resolve => setTimeout(resolve, 2100));
    response = await wire('PROPFIND', path, { Depth: '0', 'Content-Type': 'application/xml' }, '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>');
  }
  status(response, 207);
  const etag = response.body.match(/<(?:[\w-]+:)?getetag[^>]*>([^<]+)</)?.[1]?.replaceAll('&quot;', '"');
  assert.match(etag, /^"[^\"]*"$/);
  return etag;
}
const lockBody = '<d:lockinfo xmlns:d="DAV:"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype></d:lockinfo>';
await row('PROPFIND namespace/base/trailing slash', 'positive', async () => {
  const response = await wire('PROPFIND', '/', { Depth: '0', 'Content-Type': 'application/xml' }, '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/></d:prop></d:propfind>');
  status(response, 207); assert.match(response.body, /DAV:/);
});
await row('conditional PUT accepted and stale/exclusive PUT preserved', 'guard', async () => {
  status(await wire('PUT', '/put', { 'If-None-Match': '*' }, 'one'), 201);
  const original = await stableGet('/put');
  status(await wire('PUT', '/put', { 'If-None-Match': '*' }, 'bad'), 412);
  status(await wire('PUT', '/put', { 'If-Match': '"wrong"' }, 'bad'), 412);
  assert.equal((await get('/put')).body, 'one');
  status(await wire('PUT', '/put', { 'If-Match': original.headers.etag }, 'two-new'), 204);
  assert.equal((await get('/put')).body, 'two-new');
});
for (const method of ['COPY', 'MOVE']) {
  await row(`${method} stale source If-Match preserves both entries`, 'guard', async () => {
    await put(`/${method}-stale-source`, 'source'); await put(`/${method}-stale-target`, 'target');
    status(await wire(method, `/${method}-stale-source`, { Destination: `${base}/${method}-stale-target`, Overwrite: 'T', 'If-Match': '"stale"' }), 412);
    assert.equal((await get(`/${method}-stale-source`)).body, 'source');
    assert.equal((await get(`/${method}-stale-target`)).body, 'target');
  });
  await row(`${method} source If-Match with distinct destination ETag`, 'positive', async () => {
    await put(`/${method}-source`, 'source bytes'); await put(`/${method}-target`, 'OLD');
    const source = await stableGet(`/${method}-source`);
    const target = await stableGet(`/${method}-target`);
    status(await wire(method, `/${method}-source`, { Destination: `${base}/${method}-target`, Overwrite: 'T', 'If-Match': source.headers.etag, If: `<${base}/${method}-target> ([${target.headers.etag}])` }), 204);
    assert.equal((await get(`/${method}-target`)).body, 'source bytes');
  });
  await row(`${method} absent target source If-Match`, 'positive', async () => {
    await put(`/${method}-new-source`, 'new bytes');
    const source = await stableGet(`/${method}-new-source`);
    status(await wire(method, `/${method}-new-source`, { Destination: `${base}/${method}-new-target`, Overwrite: 'F', 'If-Match': source.headers.etag }), 201);
    assert.equal((await get(`/${method}-new-target`)).body, 'new bytes');
  });
  await row(`${method} Overwrite F and stale destination tagged If`, 'guard', async () => {
    await put(`/${method}-guard-source`, 'source'); await put(`/${method}-guard-target`, 'target');
    const headers = { Destination: `${base}/${method}-guard-target` };
    status(await wire(method, `/${method}-guard-source`, { ...headers, Overwrite: 'F' }), 412);
    status(await wire(method, `/${method}-guard-source`, { ...headers, Overwrite: 'T', If: `<${headers.Destination}> (["stale"])` }), 412);
    assert.equal((await get(`/${method}-guard-target`)).body, 'target');
    assert.equal((await get(`/${method}-guard-source`)).body, 'source');
  });
  await row(`${method} wrong destination lock token preserves bytes`, 'guard', async () => {
    await put(`/${method}-wrong-source`, 'source'); await put(`/${method}-wrong-target`, 'target');
    const lock = await wire('LOCK', `/${method}-wrong-target`, { Depth: 'infinity', Timeout: 'Second-60', 'Content-Type': 'application/xml' }, lockBody);
    status(lock, 200);
    const token = lock.headers['lock-token'];
    const result = await wire(method, `/${method}-wrong-source`, { Destination: `${base}/${method}-wrong-target`, Overwrite: 'T', If: `<${base}/${method}-wrong-target> (<opaquelocktoken:00000000-0000-4000-8000-000000000000>)` });
    assert.equal((await get(`/${method}-wrong-target`)).body, 'target');
    assert.equal((await get(`/${method}-wrong-source`)).body, 'source');
    await wire('UNLOCK', `/${method}-wrong-target`, { 'Lock-Token': token.startsWith('<') ? token : `<${token}>` });
    status(result, 412);
  });
  await row(`${method} destination LOCK token and unlock after overwrite`, 'positive', async () => {
    await put(`/${method}-lock-source`, 'source'); await put(`/${method}-lock-target`, 'target');
    const lock = await wire('LOCK', `/${method}-lock-target`, { Depth: 'infinity', Timeout: 'Second-60', 'Content-Type': 'application/xml' }, lockBody);
    status(lock, 200);
    const token = lock.headers['lock-token'];
    const coded = token.startsWith('<') ? token : `<${token}>`;
    status(await wire('PUT', `/${method}-lock-target`, {}, 'blocked'), 423);
    status(await wire(method, `/${method}-lock-source`, { Destination: `${base}/${method}-lock-target`, Overwrite: 'T', If: `<${base}/${method}-lock-target> (${coded})` }), 204);
    assert.equal((await get(`/${method}-lock-target`)).body, 'source');
    const unlock = await wire('UNLOCK', `/${method}-lock-target`, { 'Lock-Token': coded });
    await wire('PROPFIND', `/${method}-lock-target`, { Depth: '0', 'Content-Type': 'application/xml' }, '<d:propfind xmlns:d="DAV:"><d:prop><d:lockdiscovery/></d:prop></d:propfind>');
    status(unlock, 204);
  });
}
await row('PROPFIND getetag is an HTTP entity-tag', 'positive', async () => {
  await put('/property-etag', 'bytes');
  await propEtag('/property-etag');
});
await row('LOCK header is RFC coded-URL', 'positive', async () => {
  await put('/lock-syntax', 'original');
  const lock = await wire('LOCK', '/lock-syntax', { Depth: 'infinity', Timeout: 'Second-60', 'Content-Type': 'application/xml' }, lockBody);
  status(lock, 200);
  const token = lock.headers['lock-token'];
  await wire('UNLOCK', '/lock-syntax', { 'Lock-Token': token.startsWith('<') ? token : `<${token}>` });
  assert.match(token, /^<[^<>]+>$/);
});
const report = { base, rows, events, inputSha256: createHash('sha256').update(await readFile(import.meta.filename)).digest('hex') };
await writeFile(`${evidence}/raw.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(rows, null, 2));
