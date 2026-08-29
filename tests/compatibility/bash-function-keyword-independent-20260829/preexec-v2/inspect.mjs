import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../../..');
const prefix = 'tests/compatibility/bash-function-keyword-author-20260829/preexec-v2/';
const names = process.argv.slice(2);
const capture = fs.openSync(path.join(root, 'READ-' + names[0] + '.jsonl'), 'wx');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (file, maximum) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error('admission ' + file);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) throw Error('size race');
  return bytes;
};
try {
  fs.writeSync(capture, JSON.stringify({ pid: process.pid, names }) + '\n');
  const raw = read(path.join(root, 'inventory.stdout'), 262144);
  if (raw.at(-1) !== 0) throw Error('NUL terminator');
  const rows = raw.subarray(0, -1).toString('utf8').split('\0').map(value => {
    const match = /^(100644) blob ([a-f0-9]{40}) +([0-9]+)\t([^\0]+)$/.exec(value);
    if (!match || !match[4].startsWith(prefix)) throw Error('inventory row');
    return { mode: match[1], oid: match[2], bytes: Number(match[3]), name: match[4].slice(prefix.length) };
  });
  if (new Set(rows.map(row => row.name)).size !== rows.length) throw Error('duplicate');
  for (const name of names) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw Error('name');
    const row = rows.find(item => item.name === name);
    if (!row || row.bytes > 131072) throw Error('bound membership ' + name);
    const bytes = read(path.join(repo, prefix, name), row.bytes);
    const oid = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (oid !== row.oid) throw Error('Git blob ' + name);
    fs.mkdirSync(path.join(root, 'frozen'), { recursive: true });
    const destination = path.join(root, 'frozen', name);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o644 });
    else if (sha(read(destination, row.bytes)) !== sha(bytes)) throw Error('snapshot changed');
    fs.writeSync(capture, JSON.stringify({ ...row, sha256: sha(bytes) }) + '\n');
    if (name === 'COMMAND-PLAN.json') {
      const value = JSON.parse(bytes); console.log(name, JSON.stringify({ keys: Object.keys(value), summary: Object.fromEntries(Object.entries(value).filter(([, item]) => !Array.isArray(item))) }));
    } else console.log(name + '\n' + bytes.toString());
  }
} catch (error) { fs.writeSync(capture, JSON.stringify({ error: String(error) }) + '\n'); process.exitCode = 1; }
finally { fs.fsyncSync(capture); fs.closeSync(capture); }
