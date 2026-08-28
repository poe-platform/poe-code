import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { installLoader } from './loader.mjs';

const directory = process.argv[2];
const kind = process.argv[3];
const filename = path.join(directory, 'dist/stub.js');
const payload = fs.readFileSync(filename);
const entry = { kind: 'file', mode: fs.statSync(filename).mode & 0o777, bytes: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex') };
if (kind === 'hash') entry.sha256 = '0'.repeat(64);
if (kind === 'mode') entry.mode = 0o600;
const loads = installLoader(directory, kind === 'missing' ? {} : { 'dist/stub.js': entry }, filename + '.worker', entry);
let rejected;
try { await import(pathToFileURL(filename).href); } catch (reason) { rejected = reason; }
assert.ok(rejected instanceof Error);
assert.match(rejected.message, kind === 'missing' ? /AP_ACTUAL_LOADER_DENIED/ : new RegExp(`load ${kind}`));
assert.equal(loads.length, 0);
console.log(JSON.stringify({ kind, rejected: true, candidateLoads: 0, message: rejected.message }));
