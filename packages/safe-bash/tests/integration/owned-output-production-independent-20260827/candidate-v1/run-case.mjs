import { readFileSync } from 'node:fs';
import { setImmediate as turn } from 'node:timers/promises';
import { cases } from './core-cases.mjs';
import './network-cases.mjs';
import { assertObservation } from './assert-observation.mjs';
const id = process.argv[2], fixture = JSON.parse(readFileSync(new URL('./CASES.json', import.meta.url))).cases.find(row => row.id === id);
const observation = { id, events: [], values: {} }, unhandled = [];
const rejection = reason => { unhandled.push(String(reason)); };
process.on('unhandledRejection', rejection);
try {
  if (!cases[id]) throw new Error('NOT_IMPLEMENTED ' + id);
  await cases[id](observation.events, observation.values); await turn(); await turn();
  observation.values.unhandledRejections = unhandled.length;
  assertObservation(fixture, observation); console.log(JSON.stringify({ status: 'PASS', observation, unhandled }));
} catch (error) { console.log(JSON.stringify({ status: 'FAIL', observation, unhandled, error: error.stack })); process.exitCode = 1; }
finally { process.off('unhandledRejection', rejection); }
