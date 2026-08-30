import * as fs from 'node:fs/promises';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const birth = process.hrtime.bigint().toString();
process.send({ kind: 'birth', pid: process.pid, ppid: process.ppid, born: birth, pgid: process.pid });
await new Promise(resolve => process.once('message', message => { if (message.kind !== 'admit') throw new Error('admission required'); resolve(); }));
const packet = JSON.parse(await fs.readFile(process.argv[2]));
if (packet.mode === 'control') {
  process.send({ kind: 'control', value: 'bounded-node-ipc-control' });
  console.log('bounded-node-ipc-control');
} else if (packet.mode === 'compiler') {
  process.argv = [process.execPath, packet.compiler, ...packet.args];
  await import(pathToFileURL(packet.compiler).href);
} else {
  register(pathToFileURL(packet.loader).href, { parentURL: import.meta.url, data: packet.binding });
  const namespace = await import(pathToFileURL(packet.entry).href);
  await namespace.run(packet);
}
process.send?.({ kind: 'settled', pid: process.pid });
process.disconnect?.();
