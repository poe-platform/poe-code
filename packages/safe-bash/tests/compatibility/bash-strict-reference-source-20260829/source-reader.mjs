import { lstat, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
const stage = process.argv[2]; assert(/^0[1-8]$/.test(stage));
await writeFile(root + 'SOURCE-' + stage + '-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), role: 'AUTHENTICATED_SOURCE_READ_ONLY', children: 0 }) + '\n', { flag: 'wx', mode: 0o600 });
try {
  const inventory = JSON.parse(await readFile(root + 'binding/gnu-inventory.stdout.raw', 'utf8'));
  assert.equal(inventory.sha256, '75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e');
  const requests = JSON.parse(process.argv[3]); assert(Array.isArray(requests) && requests.length <= 20);
  const prior = [];
  for (const name of await readdir(root)) if (/^SOURCE-0[1-8]-RESULT.json$/.test(name)) prior.push(JSON.parse(await readFile(root + name, 'utf8')));
  const counted = new Set(prior.flatMap(row => row.identities.map(item => item.role + ':' + item.name)));
  let bytesRead = prior.reduce((sum, row) => sum + row.sourceBytesRead, 0);
  const identities = []; const results = []; let currentBytes = 0;
  const productBindings = JSON.parse(await readFile(root + 'product/RESULT.json', 'utf8'));
  for (const request of requests) {
    const role = request.product ? 'FROZEN_PRODUCT' : 'GNU_5_3_15';
    const name = request.file; assert(typeof name === 'string' && !name.includes('..') && !name.split('/').some(part => part.toLowerCase() === 'agents.md'));
    let pathname; let expected; let commit;
    if (request.product) {
      const row = productBindings.records.find(item => item.name === name); assert(row && row.status.code === 0 && row.closed);
      pathname = root + 'product/' + name + '.stdout.raw'; expected = row.sha256; commit = row.argv[1];
    } else {
      const row = inventory.rows.find(item => item.path === 'bash-5.3/' + name); assert(row && row.type === '0');
      pathname = inventory.source + '/' + name; expected = row.sha256; commit = inventory.sha256;
    }
    const status = await lstat(pathname); assert(status.isFile() && !status.isSymbolicLink() && status.size <= 2 * 1024 * 1024);
    counted.add(role + ':' + name); assert(counted.size <= 64);
    bytesRead += status.size; currentBytes += status.size; assert(bytesRead <= 12 * 1024 * 1024);
    const bytes = await readFile(pathname); const sha256 = createHash('sha256').update(bytes).digest('hex'); assert.equal(sha256, expected);
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
    identities.push({ role, name, bytes: status.size, sha256, authority: commit, lines: lines.length });
    const selected = request.pattern ? lines.flatMap((line, index) => new RegExp(request.pattern).test(line) ? [{ line: index + 1, text: line }] : []).slice(0, request.limit ?? 100) : lines.slice(request.start - 1, request.end).map((line, index) => ({ line: request.start + index, text: line }));
    assert(selected.length <= 400);
    results.push({ role, name, selected });
  }
  await writeFile(root + 'SOURCE-' + stage + '-RESULT.json', JSON.stringify({ identities, sourceBytesRead: currentBytes, cumulativeSourceBytes: bytesRead, distinctSources: counted.size, requests, results }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (const row of results) { console.log(row.role + ' ' + row.name); for (const line of row.selected) console.log(line.line + ': ' + line.text); }
} catch (error) { await writeFile(root + 'SOURCE-' + stage + '-FAILURE.json', JSON.stringify({ message: error.message, stack: error.stack }) + '\n', { flag: 'wx', mode: 0o600 }); process.exitCode = 1; }
