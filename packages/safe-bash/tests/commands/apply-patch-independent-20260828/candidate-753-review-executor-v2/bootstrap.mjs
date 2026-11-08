import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { installLoader } from './loader.mjs';
import { readPacket } from './manifest.mjs';
import { authority } from './authority.mjs';

const job = readPacket(process.argv[2], authority);
assert.equal(job.schema, 'AP753-job-v1');
assert.deepEqual(Object.fromEntries(Object.entries(process.env).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)), job.env);
assert.equal(job.consumer, fs.realpathSync(path.dirname(process.argv[2])));
for (const [name, entry] of Object.entries(job.harness)) {
  const filename = path.join(job.consumer, name);
  assert.equal(fs.realpathSync(filename), filename);
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile()); assert.equal(stat.mode & 0o777, entry.mode);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, entry.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
}
const deny = () => { throw new Error('AP753_NETWORK_DENIED'); };
for (const target of [http, https]) for (const name of ['request', 'get', 'createServer']) target[name] = deny;
for (const name of ['connect', 'createConnection', 'createServer']) net[name] = deny;
net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny; tls.connect = deny;
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) dns[name] = deny;
syncBuiltinESMExports();
globalThis.reviewJob = job; globalThis.reviewMarkers = [];
globalThis.reviewLoads = installLoader(job);
await import(pathToFileURL(path.join(job.consumer, 'dispatch.mjs')).href);
