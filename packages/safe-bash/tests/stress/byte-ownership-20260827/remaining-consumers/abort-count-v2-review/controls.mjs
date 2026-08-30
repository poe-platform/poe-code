import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Shell, createMemoryFileSystem, structuredCommands, readBytes } from 'virtual-bash';
import { borrowed, hex } from './fixtures.mjs';
import { vectors, commands } from './vectors.mjs';

const expectedState = { yielded: 2, resumed: 1, finalized: true, unchangedChecks: 2 };
const watchdog = { timeout: 15000 };
let direct;
let publicObservation;

function verifyState(state) {
  assert.deepEqual(state, expectedState);
}

function verifyPublic(observation) {
  assert.equal(observation.rejected, true);
  assert.equal(observation.error, observation.reason);
  assert.deepEqual(observation.accepted, []);
  assert.deepEqual(observation.stderr, []);
  assert.deepEqual(observation.after, observation.before);
  assert.equal(observation.openings, 1);
  assert.equal(observation.disposed, true);
  verifyState(observation.state);
}

test('unchanged helper readBytes exact schedule and delivered bytes', watchdog, async context => {
  const controller = new AbortController();
  const reason = new Error('remaining-consumers caller abort');
  const trace = [];
  const item = borrowed('Buffer', vectors.raw.chunks, resumed => {
    trace.push({ event: 'afterRead', resumed, state: { ...item.state } });
    controller.abort(reason);
    trace.push({ event: 'abort-returned', aborted: controller.signal.aborted });
  });
  const delivered = [];
  await assert.rejects(async () => {
    for await (const chunk of readBytes(item.source, controller.signal)) {
      delivered.push(hex(chunk));
      trace.push({ event: 'delivered', hex: hex(chunk), state: { ...item.state } });
    }
  }, error => error === reason);
  verifyState(item.state);
  assert.deepEqual(delivered, ['41e2']);
  assert.deepEqual(trace, [
    { event: 'delivered', hex: '41e2', state: { yielded: 1, resumed: 0, finalized: false, unchangedChecks: 0 } },
    { event: 'afterRead', resumed: 1, state: { yielded: 1, resumed: 1, finalized: false, unchangedChecks: 1 } },
    { event: 'abort-returned', aborted: true },
  ]);
  direct = { trace, delivered, state: { ...item.state } };
  context.diagnostic(JSON.stringify(direct));
});

test('old-count assertion mutant fails against actual schedule', () => {
  assert.ok(direct);
  assert.throws(() => assert.deepEqual(direct.state, { yielded: 1, resumed: 1, finalized: true, unchangedChecks: 1 }), { code: 'ERR_ASSERTION' });
});

test('public jq exact reason, empty sinks, unchanged VFS and cleanup', watchdog, async context => {
  const controller = new AbortController();
  const reason = new Error('remaining-consumers caller abort');
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', Buffer.from(vectors.raw.whole, 'hex'));
  const before = { entries: await fs.readdir('/'), input: hex(await fs.readFile('/input')) };
  const item = borrowed('Buffer', vectors.raw.chunks, () => controller.abort(reason));
  let openings = 0;
  fs.readStream = (path, options) => {
    assert.equal(path, '/input');
    assert.ok(options.signal);
    options.signal.throwIfAborted();
    openings++;
    return item.source;
  };
  const shell = new Shell({ fs });
  context.after(() => shell.dispose());
  shell.use(structuredCommands());
  const accepted = [];
  const stderr = [];
  let rejected = false;
  let error;
  try {
    await shell.exec(commands.raw, { signal: controller.signal,
      stdout: { async write(chunk) { accepted.push(hex(chunk)); } },
      stderr: { async write(chunk) { stderr.push(hex(chunk)); } } });
  } catch (caught) { rejected = true; error = caught; }
  const state = { ...item.state };
  const after = { entries: await fs.readdir('/'), input: hex(await fs.readFile('/input')) };
  await shell.dispose();
  publicObservation = { rejected, error, reason, accepted, stderr, before, after, openings, disposed: true, state };
  verifyPublic(publicObservation);
  context.diagnostic(JSON.stringify({ ...publicObservation, error: String(error), reason: String(reason), exactReasonIdentity: error === reason }));
});

test('wrong-reason negative guard rejects actual-observation mutant', () => {
  assert.ok(publicObservation);
  assert.throws(() => verifyPublic({ ...publicObservation, error: new Error(publicObservation.reason.message) }), { code: 'ERR_ASSERTION' });
});

test('accepted-byte negative guard rejects actual-observation mutant', () => {
  assert.ok(publicObservation);
  assert.throws(() => verifyPublic({ ...publicObservation, accepted: ['41'] }), { code: 'ERR_ASSERTION' });
});

test('missing-finalization negative guard rejects actual-observation mutant', () => {
  assert.ok(publicObservation);
  assert.throws(() => verifyPublic({ ...publicObservation, state: { ...publicObservation.state, finalized: false } }), { code: 'ERR_ASSERTION' });
});

after(() => console.log('REVIEW_CLOSURE ' + JSON.stringify({ resources: process.getActiveResourcesInfo(), controls: 6 })));
