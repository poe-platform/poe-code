import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.cwd();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let total = 0;
try {
  console.log('INSPECTION', JSON.stringify({ at: new Date().toISOString(), pid: process.pid, mode: 'SOURCE_DATA_ONLY' }));
  for (const argument of process.argv.slice(2)) {
    const [relative, selected = '1:160'] = argument.split('#');
    if (!['tests/integration/agent-bash-coherent-', 'tests/integration/node-public-author-20260829/', 'tests/commands/node-author-20260829/'].some(prefix => relative.startsWith(prefix)) || relative.includes('..') || path.basename(relative) === 'AGENTS.md') throw new Error('scope');
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 2097152) throw new Error(`type/size ${relative} ${stat.size}`);
    total += stat.size;
    if (total > 8388608) throw new Error('aggregate');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== stat.size) throw new Error('size race');
    console.log('BINDING', JSON.stringify({ relative, bytes: bytes.length, sha256: sha(bytes) }));
    if (selected === 'catalog') {
      const value = JSON.parse(bytes.toString('utf8'));
      const record = entry => Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, typeof item === 'string' && item.length > 300 ? { stringBytes: Buffer.byteLength(item) } : Array.isArray(item) ? { count: item.length } : item]));
      console.log(JSON.stringify(Array.isArray(value) ? value.map(record) : record(value), null, 2));
    } else if (selected === 'keys') {
      const value = JSON.parse(bytes.toString('utf8'));
      console.log(JSON.stringify(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, Array.isArray(entry) ? { length: entry.length, first: entry[0] } : entry])), null, 2));
    } else {
      const [first, last] = selected.split(':').map(Number);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 300) throw new Error('line bounds');
      console.log(bytes.toString('utf8').split('\n').slice(first - 1, last).map((line, index) => `${first + index}:${line}`).join('\n'));
    }
  }
} catch (error) { console.error(error); process.exitCode = 78; }
