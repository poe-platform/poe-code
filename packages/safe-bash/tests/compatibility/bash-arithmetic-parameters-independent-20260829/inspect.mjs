import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import path from 'node:path';

const root = process.cwd();
const maximum = 4 * 1024 * 1024;
const admitted = new Map();
let totalRead = 0;
let requests = 0;
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  try {
    const request = JSON.parse(line);
    requests += 1;
    const filename = path.resolve(root, request.file);
    if (!filename.startsWith(root + path.sep) || !/\.(md|json|mjs|ts|sh|txt|diff|base64)$/.test(filename)) throw Error('path/type admission');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > maximum) throw Error('regular-file/size admission');
    const buffer = fs.readFileSync(filename);
    totalRead += buffer.length;
    if (totalRead > 48 * 1024 * 1024) throw Error('read ceiling');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    admitted.set(request.file, { bytes: buffer.length, sha256 });
    const text = buffer.toString('utf8');
    let output;
    if (request.keys) {
      const value = JSON.parse(text);
      output = JSON.stringify(request.keys.map(key => [key, key === '*' ? Object.keys(value) : value[key]]), null, 2);
    } else if (request.hash) {
      output = JSON.stringify({ file: request.file, bytes: buffer.length, sha256 });
    } else {
      output = text.split('\n').map((value, index) => `${index + 1}: ${value}`).slice((request.start ?? 1) - 1, request.end ?? Infinity).join('\n');
    }
    if (Buffer.byteLength(output) > 30000) throw Error('output request too large; choose a smaller range');
    console.log(output);
    console.log(JSON.stringify({ requests, totalRead, admitted: admitted.size }));
  } catch (error) {
    console.log(JSON.stringify({ error: String(error), requests, totalRead }));
  }
}
fs.writeFileSync('tests/compatibility/bash-arithmetic-parameters-independent-20260829/admissions.json', JSON.stringify({ requests, totalRead, files: Object.fromEntries(admitted) }, null, 2) + '\n');
