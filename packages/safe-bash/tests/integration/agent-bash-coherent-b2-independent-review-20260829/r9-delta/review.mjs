import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import assert from 'node:assert/strict';
const root = process.cwd();
const output = path.join(root, 'tests/integration/agent-bash-coherent-b2-independent-review-20260829/r9-delta');
const start = Date.now();
const cache = new Map();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let serial = 0;
function read(relative) {
  assert(Date.now() - start < 240000, 'deadline');
  assert(!relative.includes('AGENTS.md'));
  const absolute = path.resolve(root, relative);
  assert(absolute.startsWith(root + '/') || absolute === '/private/tmp/B2-R9-ROOT-GO.json');
  if (cache.has(absolute)) return cache.get(absolute);
  const stat = fs.lstatSync(absolute);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1048576);
  const body = fs.readFileSync(absolute);
  assert.equal(body.length, stat.size);
  const record = { path: absolute, bytes: body.length, sha256: hash(body), mode: stat.mode & 0o777, body };
  fs.writeFileSync(path.join(output, 'raw', String(++serial) + '.txt'), body, { flag: 'wx' });
  cache.set(absolute, record);
  return record;
}
const rl = readline.createInterface({ input: process.stdin });
console.log(JSON.stringify({ startedUTC: new Date(start).toISOString(), pid: process.pid, childSpawns: 0 }));
for await (const command of rl) {
  try {
    if (command === 'finish') {
      const { finish } = await import('./finish.mjs');
      const result = await finish({ read, cache, root, output, hash, start });
      console.log(JSON.stringify(result));
      break;
    }
    const [relative, offset = '0', length = '16000'] = command.split(' ');
    const record = read(relative);
    console.log(JSON.stringify({ ...record, body: undefined, text: record.body.toString('utf8', Number(offset), Number(offset) + Number(length)) }));
  } catch (error) {
    console.log(JSON.stringify({ failure: String(error), stack: error?.stack }));
    fs.writeFileSync(path.join(output, 'STOP.json'), JSON.stringify({ failure: String(error), stack: error?.stack, at: new Date().toISOString() }), { flag: 'wx' });
    process.exitCode = 78;
    break;
  }
}
console.log(JSON.stringify({ endedUTC: new Date().toISOString(), pid: process.pid, childSpawns: 0 }));
