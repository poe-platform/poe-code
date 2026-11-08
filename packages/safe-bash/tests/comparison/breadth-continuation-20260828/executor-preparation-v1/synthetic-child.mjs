import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const record = value => appendFileSync(3, `${JSON.stringify(value)}\n`);
if (mode === 'leak') {
  const timer = setInterval(() => {}, 1000);
  record({ kind: 'result', exitCode: 0, outputMatches: true });
  process.once('SIGTERM', () => { clearInterval(timer); record({ kind: 'cleanup', timerRetired: true }); });
} else if (mode === 'clean') {
  record({ kind: 'result', exitCode: 0, outputMatches: true });
  record({ kind: 'cleanup', resources: 0 });
} else if (['positive', 'fallback', 'wrong-load', 'noop'].includes(mode)) {
  const files = {};
  const names = ['expected.mjs', 'wrong.mjs', 'forbidden-source.mjs'];
  for (const name of names) {
    const filename = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
    const bytes = readFileSync(filename);
    files[filename] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const expected = fileURLToPath(new URL('./fixtures/expected.mjs', import.meta.url));
  const wrong = fileURLToPath(new URL('./fixtures/wrong.mjs', import.meta.url));
  const source = new URL('./fixtures/forbidden-source.mjs', import.meta.url).href;
  if (mode === 'wrong-load') files[wrong].sha256 = files[expected].sha256;
  const channel = new MessageChannel();
  let flush;
  const flushed = new Promise(resolve => { flush = resolve; });
  channel.port1.on('message', message => { record(message); if (message.kind === 'flushed') flush(); });
  register(new URL('./observe-load.mjs', import.meta.url), { parentURL: import.meta.url, data: { files, deniedUrls: [source], port: channel.port2 }, transferList: [channel.port2] });
  try {
    const entry = mode === 'fallback' ? source : new URL(`./fixtures/${mode === 'wrong-load' ? 'wrong' : 'expected'}.mjs`, import.meta.url).href;
    const library = await import(entry);
    record({ kind: 'evaluated-export-call', entry, observation: library.observe() });
  } catch (error) { record({ kind: 'caught', code: error.code, name: error.name, message: error.message }); }
  finally { channel.port1.postMessage({ flush: true }); await flushed; channel.port1.close(); }
  record({ kind: 'cleanup', resources: 0 });
} else {
  record({ kind: 'refusal', code: 'SYNTHETIC_MODE_ONLY' });
  process.exitCode = 2;
}
