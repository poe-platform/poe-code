import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';

const root = process.cwd();
const owned = 'tests/compatibility/bash-ere-l02-repair-independent-20260829';
const records = new Map();
let requests = 0;
let bytesRead = 0;
for await (const line of readline.createInterface({ input: process.stdin })) {
  try {
    const request = JSON.parse(line);
    requests++;
    const filename = path.resolve(root, request.file);
    if (!filename.startsWith(root + path.sep) || !/\.(txt|json|md|mjs|js|ts|diff)$/.test(filename)) throw Error('PATH_TYPE');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('TYPE_SIZE');
    const bytes = fs.readFileSync(filename);
    bytesRead += bytes.length;
    if (bytesRead > 64 * 1024 * 1024) throw Error('READ_CAP');
    const pin = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    records.set(request.file, pin);
    let output;
    if (request.tree) output = bytes.toString().split('\0').filter(Boolean).map(record => record.slice(record.indexOf('\t') + 1)).join('\n');
    else if (request.keys) { const data = JSON.parse(bytes); output = JSON.stringify(Object.fromEntries(request.keys.map(key => [key, key === '*' ? Object.keys(data) : data[key]])), null, 2); }
    else if (request.hash) output = JSON.stringify(pin);
    else {
      const text = bytes.toString().split('\n');
      output = request.find ? text.flatMap((value, index) => value.includes(request.find) ? text.slice(Math.max(0,index-3),index+18).map((entry, offset) => `${Math.max(0,index-3)+offset+1}: ${entry}`) : []).join('\n') : text.slice((request.start ?? 1)-1, request.end ?? 100).map((value,index) => `${(request.start ?? 1)+index}: ${value}`).join('\n');
    }
    if (Buffer.byteLength(output) > 24000) throw Error('DISPLAY_CAP');
    console.log(output);
    console.log(JSON.stringify({ requests, bytesRead }));
  } catch (reason) { console.log(JSON.stringify({ error: String(reason), requests, bytesRead })); }
}
fs.writeFileSync(owned + '/admissions.json', JSON.stringify({ requests, bytesRead, files: Object.fromEntries(records) }, null, 2) + '\n');
