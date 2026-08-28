import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [mode, jobId, recipeRoot, payloadPath, target] = process.argv.slice(2);
const emit = async (receipt) => new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(receipt)}\n`, (error) => error ? reject(error) : resolve()));
const payload = payloadPath === '-' ? {} : JSON.parse(readFileSync(payloadPath, 'utf8'));

if (mode === 'identities') {
  const { encodeRejection, createFixtureContext } = await import(pathToFileURL(join(recipeRoot, 'context.mjs')));
  const first = { name: 'same', message: 'same' };
  const second = { name: 'same', message: 'same' };
  const symbol = Symbol('same');
  const callback = () => {};
  const hostile = Object.create(null);
  Object.defineProperty(hostile, 'message', { get() { throw new Error('getter'); } });
  const fixture = createFixtureContext(payload);
  fixture.context.registerCleanup(() => { throw first; });
  fixture.context.registerCleanup(() => { throw second; });
  const captured = {
    first: encodeRejection(first), firstAgain: encodeRejection(first), second: encodeRejection(second),
    primitives: [undefined, null, false, true, 0, -0, 1, '1', 1n, NaN, Infinity, -Infinity, 'undefined', 'null', 'false'].map(encodeRejection),
    symbols: [symbol, symbol, Symbol('same')].map(encodeRejection),
    functions: [callback, callback, () => {}].map(encodeRejection),
    cleanup: await fixture.drain(),
  };
  if (payload.hostile) captured.hostile = encodeRejection(hostile);
  await emit({ schemaVersion: 1, jobId, outcome: 'CAPTURED', captured });
} else if (mode === 'fence') {
  register(pathToFileURL(join(recipeRoot, 'import-fence.mjs')), { data: { compiledRoot: target } });
  let result;
  try { const fixture = await import(pathToFileURL(join(target, 'timer-fixture.mjs'))); result = { accepted: true, available: fixture.available }; }
  catch (error) { result = { accepted: false, message: String(error) }; }
  await emit({ schemaVersion: 1, jobId, outcome: 'CAPTURED', result });
} else {
  if (mode === 'mutate-content') writeFileSync(join(target, 'input.bin'), 'changed');
  if (mode === 'mutate-mode') chmodSync(join(target, 'input.bin'), 0o600);
  if (mode === 'mutate-file') writeFileSync(join(target, 'added.bin'), 'new', { flag: 'wx' });
  if (mode === 'mutate-directory') mkdirSync(join(target, 'added'));
  if (mode === 'malformed') process.stdout.write('not-json\n');
  else await emit({ ...payload, jobId: mode === 'wrong-job' ? 'other' : jobId });
  if (mode === 'nonzero') process.exitCode = 7;
  if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
  if (mode === 'timeout') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
  if (mode === 'overflow') process.stdout.write('x'.repeat(131072));
}
