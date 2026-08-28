import { registerHooks } from 'node:module';
import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const root = new URL('.', import.meta.url);
const presealUrl = new URL('PRESEAL.json', root);
const presealStat = lstatSync(presealUrl);
if (!presealStat.isFile() || presealStat.isSymbolicLink() || presealStat.size > 65536) throw Error('preseal admission');
const seal = JSON.parse(readFileSync(presealUrl, 'utf8'));
const records = new Map(seal.modules.map(record => [new URL(record.path, root).href, record]));
const loaded = [], edges = [];
function authenticate(url) {
  const record = records.get(url);
  if (!record) throw Error('unknown module');
  const filename = fileURLToPath(url), stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(filename) !== filename || stat.size !== record.bytes || stat.size > 65536) throw Error('module admission');
  const bytes = readFileSync(filename);
  if (digest(bytes) !== record.sha256) throw Error('module hash');
  return { record, bytes };
}
authenticate(import.meta.url);
const builtins = new Set();
registerHooks({
  resolve(specifier, context) {
    const { record } = authenticate(context.parentURL);
    const edge = record.edges.find(edge => edge.specifier === specifier);
    if (!edge || edges.length >= 32) throw Error('unsealed edge');
    edges.push({ importer: record.path, specifier, target: edge.target });
    if (edge.target.startsWith('node:')) { builtins.add(edge.target); return { url: edge.target, shortCircuit: true }; }
    const url = new URL(edge.target, root).href;
    authenticate(url);
    return { url, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) { if (!builtins.has(url)) throw Error('builtin without edge'); return nextLoad(url, context); }
    const { record, bytes } = authenticate(url);
    if (loaded.length >= 16) throw Error('load cap');
    loaded.push({ path: record.path, bytes: bytes.length, sha256: record.sha256 });
    return { format: 'module', shortCircuit: true, source: bytes };
  }
});
const { observeReason } = await import('./observe.mjs');
const { createOwner } = await import('../preparation-v7-capture/actual-v7-01/capsule/owner.mjs');
const { createFixture } = await import('../preparation-v7-capture/actual-v7-01/capsule/fixtures.mjs');
const { typedErrorDTO } = await import('../preparation-v7-capture/actual-v7-01/capsule/errors.mjs');
const { request } = await import('../preparation-v7-capture/actual-v7-01/capsule/wire.mjs');
let registered;
const owner = createOwner(cleanup => { registered = cleanup; });
const primary = { present: false, value: undefined };
const secondary = [];
let operation, facts, observation, recognized = false, guard = null;
try {
  const fixture = createFixture(seal.case, owner);
  const input = request(seal.request, 1, 2);
  if (!fixture.authorize(input)) throw Error('probe grant denial');
  operation = fixture.start(input, new Uint8Array(0), owner.signal);
  try { await operation.result; } catch (value) { primary.present = true; primary.value = value; }
  if (primary.present) {
    recognized = fixture.recognizeFsError(primary.value);
    observation = observeReason(primary.value, fixture.recognizeFsError);
    try { guard = { returned: true, dto: typedErrorDTO(primary.value, fixture.recognizeFsError) }; }
    catch (value) { guard = { returned: false, rejectionPresent: true, samePrimary: Object.is(value, primary.value) }; }
  }
} finally {
  if (operation) try { await operation.close(); } catch (value) { secondary.push({ present: true, value }); }
  try { facts = await registered(); } catch (value) { secondary.push({ present: true, value }); }
}
const receipt = { schema: 'parent-only-l02-v1', primaryPresent: primary.present, recognized, observation, guard, secondary: secondary.map(record => ({ present: record.present, samePrimary: Object.is(record.value,primary.value) })), cleanup: facts, events: owner.events, ownerFailures: owner.failures.length, loaded, edges, counts: { fsStarts: operation ? 1 : 0, workers: 0, guests: 0, engines: 0, compilers: 0 } };
const encoded = JSON.stringify(receipt);
if (Buffer.byteLength(encoded) > 65536) throw Error('receipt cap');
await new Promise((resolve, reject) => process.stdout.write(encoded + '\n', error => error ? reject(error) : resolve()));
if (!primary.present || !recognized || !facts?.cleanupClosed || !facts?.cleanupSettled || facts.acquisition !== 'proven-none' || secondary.length || owner.failures.length) process.exitCode = 1;
