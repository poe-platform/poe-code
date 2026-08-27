import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cursorControls } from './followup-controls.mjs';

const api = await import(pathToFileURL(process.env.REVIEW_MODULE).href);
const options = { reportErrors: true, work: { maxArguments: 64, maxBytes: 4096, maxSteps: 16384, yieldEvery: 16, checkpoint: () => {} } };
const results = [];
for (const control of cursorControls) {
  const initial = api.createGetoptsState();
  const first = await api.scanGetopts(initial, 'pqr', control.firstArgs, options);
  const clone = api.cloneGetoptsState(first.state);
  const jumped = api.withGetoptsIndex(clone, 2);
  const second = await api.scanGetopts(jumped, 'pqr', control.secondArgs, options);
  const actual = [first, second].map((result) => [String(result.status), result.option, String(result.optind), result.argument.kind === 'set' ? 'x' : '', result.argument.kind === 'set' ? result.argument.value : '']);
  results.push({ ...control, actual, pass: JSON.stringify(actual) === JSON.stringify(control.expected), transitions: { initial, first, clone, jumped, second } });
}
await writeFile(process.env.REVIEW_OUTPUT, JSON.stringify({ mode: process.env.REVIEW_MODE, module: process.env.REVIEW_MODULE, results }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ total: results.length, pass: results.filter((result) => result.pass).length, fail: results.filter((result) => !result.pass).length }));
