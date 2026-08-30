import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const packet = JSON.parse(readFileSync(process.argv[2]));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(process.execPath, packet.node.path); assert.equal(process.version, packet.node.version);
assert.equal(hash(readFileSync(packet.loader)), packet.loaderSha256);
console.log(JSON.stringify({ kind: 'birth', pid: process.pid, ppid: process.ppid, execPath: process.execPath, version: process.version,
  packetSha256: hash(readFileSync(process.argv[2])) }));
register(pathToFileURL(packet.loader).href, { parentURL: import.meta.url, data: packet.binding });
const worker = await import(pathToFileURL(packet.launchEntry).href);
await worker.run(packet);
