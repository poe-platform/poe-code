import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { admitPrior, admitPublisher, countPublication } from './ledger.mjs';
const [mode, filename, expectedHash, expectedSize] = process.argv.slice(2);
const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === Number(expectedSize) && stat.size <= 65536);
const buffer = fs.readFileSync(filename); assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), expectedHash);
const input = JSON.parse(buffer);
const observed = { parentPid: process.ppid, selfPid: process.pid, startedUTC: new Date().toISOString() };
let output;
if (mode === 'preimport-like') output = admitPrior(input, observed);
else if (mode === 'publisher-like') { const publisher = admitPublisher(input, observed); output = countPublication(input, publisher, []); }
else throw new Error('UNKNOWN_PROBE');
fs.writeSync(1, JSON.stringify(output) + '\n');
