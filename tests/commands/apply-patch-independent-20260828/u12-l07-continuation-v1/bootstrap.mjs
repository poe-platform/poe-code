import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { installLoader } from './loader.mjs';

const filename = process.argv[2];
const stat = fs.lstatSync(filename);
assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1024 * 1024);
const raw = fs.readFileSync(filename);
assert.equal(createHash('sha256').update(raw).digest('hex'), process.argv[3]);
const job = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw));
assert.equal(job.schema, 'AP753-U12-L07-continuation-v1');
assert.equal(fs.realpathSync(job.consumer), job.consumer);
assert.equal(fs.realpathSync(job.product), job.product);
assert.deepEqual(Object.fromEntries(Object.entries(process.env).sort()), job.env);
for (const [name, entry] of Object.entries(job.harness)) {
  const pathname = path.join(job.consumer, name);
  const info = fs.lstatSync(pathname);
  assert.ok(info.isFile() && !info.isSymbolicLink()); assert.equal(info.mode & 0o777, entry.mode);
  assert.equal(info.size, entry.bytes);
  assert.equal(createHash('sha256').update(fs.readFileSync(pathname)).digest('hex'), entry.sha256);
}
const deny = () => { throw new Error('CONTINUATION_NETWORK_DENIED'); };
for (const object of [http, https]) for (const name of ['request', 'get', 'createServer']) object[name] = deny;
for (const name of ['connect', 'createConnection', 'createServer']) net[name] = deny;
net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny; tls.connect = deny;
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) dns[name] = deny;
syncBuiltinESMExports();
globalThis.continuationJob = job;
globalThis.continuationLoads = installLoader(job);
await import(pathToFileURL(path.join(job.consumer, 'cases.mjs')).href);
