import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { vectors } from './vectors.mjs';
import { borrowed, completed, hex, watchdog } from './fixtures.mjs';

const { collect, lines } = await import(pathToFileURL(process.env.OWNERSHIP_INTERNAL));

for (const kind of ['Buffer', 'Uint8Array']) {
  test(`internal collect offset/empty/finalizer ${kind}`, watchdog, async () => {
    const { source, state } = borrowed(kind, vectors.binary.chunks);
    assert.equal(hex(await collect(source, new AbortController().signal, 11)), vectors.binary.whole);
    completed(state, 5);
  });
  test(`internal records spanning unequal windows ${kind}`, watchdog, async () => {
    const { source, state } = borrowed(kind, vectors.records.chunks);
    const actual = [];
    for await (const line of lines(source)) actual.push({ hex: hex(line.bytes), terminated: line.terminated });
    assert.deepEqual(actual, vectors.records.lines);
    completed(state, 5);
  });
  test(`internal exact collector overflow closes source ${kind}`, watchdog, async () => {
    const { source, state } = borrowed(kind, vectors.binary.chunks);
    await assert.rejects(collect(source, new AbortController().signal, 5), error => error.code === 'EFBIG' && error.message === 'EFBIG: buffer limit exceeded (5 bytes)');
    assert.deepEqual(state, { resumed: 2, finalized: true, noMutationChecks: 3 });
  });
  test(`internal cooperative abort preserves reason ${kind}`, watchdog, async () => {
    const controller = new AbortController();
    const reason = new Error('independent collector cancellation');
    const { source, state } = borrowed(kind, vectors.binary.chunks, { afterRead: count => { if (count === 1) controller.abort(reason); } });
    await assert.rejects(collect(source, controller.signal, 11), error => error === reason);
    assert.deepEqual(state, { resumed: 1, finalized: true, noMutationChecks: 2 });
  });
  test(`internal source failure retains identity ${kind}`, watchdog, async () => {
    const reason = new Error('independent upstream failure');
    const { source, state } = borrowed(kind, vectors.binary.chunks, { afterRead: () => { throw reason; } });
    await assert.rejects(collect(source, new AbortController().signal, 11), error => error === reason);
    assert.deepEqual(state, { resumed: 1, finalized: true, noMutationChecks: 1 });
  });
}
