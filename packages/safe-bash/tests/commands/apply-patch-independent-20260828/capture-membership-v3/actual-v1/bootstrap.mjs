import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installLoader } from './loader.mjs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const worker = path.join(path.dirname(process.argv[2]), 'worker.mjs');
for (const [filename, expected] of Object.entries(job.harness)) {
  const absolute = path.join(path.dirname(worker), filename);
  assert.equal(fs.realpathSync(absolute), absolute);
  assert.equal(fs.lstatSync(absolute).mode & 0o777, expected.mode);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'), expected.sha256);
}
const manifest = JSON.parse(fs.readFileSync(job.manifest, 'utf8'));
const denyNetwork = () => { throw new Error('AP_ACTUAL_NETWORK_DENIED'); };
for (const target of [http, https]) for (const name of ['request', 'get', 'createServer']) target[name] = denyNetwork;
for (const name of ['connect', 'createConnection', 'createServer']) net[name] = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
net.Server.prototype.listen = denyNetwork;
tls.connect = denyNetwork;
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse']) dns[name] = denyNetwork;
syncBuiltinESMExports();
const loads = installLoader(job.product, manifest, worker, job.harness['worker.mjs']);
globalThis.reviewJob = job;
globalThis.reviewLoads = loads;
globalThis.reviewMarkers = [];
await import(pathToFileURL(worker).href);
