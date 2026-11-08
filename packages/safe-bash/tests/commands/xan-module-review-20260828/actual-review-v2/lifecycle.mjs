import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { deferred, source } from '../mocks.mjs';

export async function lifecycle({ job, api, module, emit }) {
  const trigger = job.trigger; const events = []; const gate = deferred(); const entered = deferred();
  const caller = new AbortController(); const local = new AbortController();
  const callerReason = Object.freeze({ code: 'ENOENT', origin: 'caller' }); const localReason = trigger === 'equal-local-reason' ? callerReason : Object.freeze({ code: 'ENOENT', origin: 'local' });
  const escaping = Error('actual sink escaping'); const cleanupError = Error('actual registered cleanup');
  const fs = new api.MemoryFileSystem(); await fs.mkdir('/work'); await fs.writeFile('/work/input.csv', Buffer.from('h\na\n'));
  const shell = new api.Shell({ fs, cwd: '/work', env: { KEEP: 'parent' } }); shell.use(module.xanCommands());
  let releases = 0; let cleanupStarts = 0; let acquired = 0; let settled = false; let disposed = false; let disposal;
  let completion;
  const cleanup = () => completion ??= (async () => { cleanupStarts++; events.push('cleanup-start'); await gate.promise; releases++; events.push('cleanup-end'); if (['failing-cleanup', 'cleanup-only'].includes(trigger)) throw cleanupError; })();
  shell.use(async (context, next) => {
    if (context.command === 'xan') {
      events.push('register'); context.registerCleanup(cleanup);
      context.registerCleanup(async () => { events.push('sibling-cleanup'); });
    }
    await next();
  });
  const stream = { [Symbol.asyncIterator]() { acquired++; events.push('acquire'); let nextIndex = 0; return {
    async next() {
      if (nextIndex++ === 0) {
        entered.resolve();
        if (['read', 'late-acquisition', 'overlap-dispose', 'equal-local-reason'].includes(trigger)) {
          if (trigger === 'equal-local-reason') local.abort(localReason);
          if (trigger !== 'overlap-dispose') caller.abort(callerReason);
          await gate.promise;
          return { done: false, value: Buffer.from('h\n') };
        }
        return { done: false, value: Buffer.from('h\n') };
      }
      return { done: true };
    },
    async return() { events.push('owned-return'); return { done: true }; },
  }; } };
  fs.readStream = () => stream;
  const stdout = { async write() {
    events.push('write'); entered.resolve();
    if (trigger === 'write') caller.abort(callerReason);
    if (trigger === 'escaping-over-local') { local.abort(localReason); throw escaping; }
    if (trigger === 'mapped-status-not-escaping') local.abort(localReason);
  } };
  shell.commands.register({ name: 'review-bridge', async execute(context) {
    events.push('bridge');
    const args = trigger === 'mapped-status-not-escaping' ? ['select', '0::1'] : ['headers', '-j', 'input.csv'];
    return context.invoke('xan', args, { signal: local.signal, stdout, stderr: stdout });
  } });
  const pending = shell.exec('review-bridge', { signal: caller.signal }).then(value => { settled = true; events.push('exec-settle'); return { value }; }, reason => { settled = true; events.push('exec-settle'); return { reason }; });
  try {
    for (let turn = 0; turn < 100 && !events.includes('write') && !events.includes('acquire') && !settled; turn++) await setImmediate();
    if (trigger === 'overlap-dispose') {
      disposal = shell.dispose(); assert.equal(shell.dispose(), disposal); disposal.then(() => { disposed = true; });
    }
    for (let turn = 0; turn < 4; turn++) await setImmediate();
    const before = { settled, disposed, cleanupStarts, acquired, events: [...events] };
    const sameCompletion = completion === undefined ? null : cleanup() === completion;
    gate.resolve(); const outcome = await pending;
    if (!disposal) disposal = shell.dispose(); await disposal; disposed = true; events.push('dispose-settle');
    const observation = { trigger, events, before, sameCompletion, releases, cleanupStarts, acquired, disposed,
      result: outcome.value, reason: outcome.reason instanceof Error ? { name: outcome.reason.name, message: outcome.reason.message } : outcome.reason,
      callerIdentity: outcome.reason === callerReason, localIdentity: outcome.reason === localReason, escapingIdentity: outcome.reason === escaping, cleanupIdentity: outcome.reason === cleanupError };
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
    assert.equal(before.settled, false, 'public exec waits registered cooperative cleanup');
    assert.equal(before.disposed, false); assert.equal(releases, 1); assert.equal(cleanupStarts, 1); assert.equal(sameCompletion, true);
    assert.ok(events.indexOf('register') < events.indexOf('acquire') || trigger === 'mapped-status-not-escaping');
    assert.ok(events.indexOf('cleanup-end') < events.indexOf('exec-settle')); assert.ok(events.includes('sibling-cleanup'));
    if (['read', 'write', 'late-acquisition', 'equal-local-reason'].includes(trigger)) assert.equal(outcome.reason, callerReason);
    if (trigger === 'escaping-over-local') assert.equal(outcome.reason, escaping);
    if (trigger === 'mapped-status-not-escaping') assert.equal(outcome.reason, localReason);
    if (['failing-cleanup', 'cleanup-only'].includes(trigger)) assert.equal(outcome.reason, cleanupError);
  } finally { gate.resolve(); await pending; await shell.dispose(); }
}
