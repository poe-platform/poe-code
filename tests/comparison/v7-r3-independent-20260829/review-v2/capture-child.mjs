import fs from 'node:fs';
import assert from 'node:assert/strict';
const count = Number(process.argv[2]);
assert.ok([65536, 65537].includes(count));
const bytes = Buffer.alloc(count, 120);
let offset = 0;
while (offset < count) offset += fs.writeSync(1, bytes, offset, count - offset);
fs.writeSync(3, JSON.stringify({ sequence: 0, kind: 'final', harmless: true }) + '\n');
