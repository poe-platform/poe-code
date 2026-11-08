import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.mjs';
import { makeHost, turn } from './support.mjs';

const [publicEntry, id] = process.argv.slice(2);
const selected = cases.find(item => item.id === id);
if (!selected) throw new Error('Explicit frozen case ID required');
const lateErrors = [];
process.on('unhandledRejection', reason => lateErrors.push({ type: typeof reason, text: String(reason) }));
const moduleLocation = pathToFileURL(publicEntry).href;
const api = await import(moduleLocation);
const host = makeHost(api);
const keepAlive = setInterval(() => {}, 1000);
const startedAt = new Date().toISOString();
let failure;
try {
  await selected.run(host);
  await turn();
  await turn();
  assert.deepEqual(lateErrors, [], 'no unhandled rejection from losing handlers or cleanup failures');
} catch (error) {
  failure = { type: typeof error, name: error?.name, message: error?.message, text: String(error), stack: error?.stack };
} finally {
  clearInterval(keepAlive);
}
console.log(JSON.stringify({ id, title: selected.title, startedAt, finishedAt: new Date().toISOString(), moduleLocation, node: process.version, pass: failure === undefined, failure, events: host.events, lateErrors, shellsCreated: host.shells.length, notes: 'No emergency gate releases or product cleanup rescue. Parent timeout is failure, never a settlement proof.' }));
if (failure !== undefined) process.exitCode = 1;
