import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { trapped } from './product-row-v1.mjs';

export const hostIds = ['literal-invoke-replace-env-parent', 'exported-not-local-lookup', 'empty-input-provenance', 'nested-shared-command-budget', 'cancel-and-late-rejection', 'awaited-sink-shared-output-budget', 'split-expansion-growth-budget'];
export async function runHost(loadLibrary, id) {
  assert.ok(hostIds.includes(id));
  return trapped(loadLibrary, async library => {
    const commands = new library.CommandRegistry();
    const fs = new library.MemoryFileSystem();
    const shell = new library.Shell({ fs, commands, env: { KEEP: 'parent', EXPORTED: 'root' } });
    shell.use(library.agentCommands());
    const observations = [];
    shell.use((context, next) => { observations.push({ command: context.command, args: [...context.args] }); return next(); });
    const captures = [];
    commands.register({ name: 'envcap', async execute(context) {
      const chunks = [];
      for await (const chunk of context.stdin) chunks.push(Buffer.from(chunk));
      captures.push({ args: [...context.args], env: { ...context.env }, stdinHex: Buffer.concat(chunks).toString('hex'), stdinIsDefault: context.stdinIsDefault });
      await context.stdout.write(Buffer.from('abc'));
      return { exitCode: 0 };
    } });
    try {
      if (id === 'literal-invoke-replace-env-parent') {
        commands.register({ name: 'bridge', execute: context => context.invoke('env', ['-S', '-i KEEP=${TOKEN} envcap "${TOKEN}" "\\$(not-evaluated)"'], { replaceEnv: true, env: { TOKEN: 'a b' }, stdin: (async function* () {})(), stdinIsDefault: false }) });
        const result = await shell.exec("LOCAL=private; bridge; printf '%s' \"$KEEP:$LOCAL\"");
        assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
        assert.equal(result.stdout, 'abcparent:private');
        assert.deepEqual(captures, [{ args: ['a b', '$(not-evaluated)'], env: { KEEP: 'a b' }, stdinHex: '', stdinIsDefault: false }]);
        assert.deepEqual(observations.map(row => row.command), ['bridge', 'env', 'envcap', 'printf']);
      } else if (id === 'exported-not-local-lookup') {
        const result = await shell.exec("LOCAL=private; export EXPORTED=public; env -S '-i A=${EXPORTED} B=${LOCAL} envcap'");
        assert.equal(result.exitCode, 0); assert.equal(captures.length, 1);
        assert.deepEqual(captures[0].env, { A: 'public', B: '' });
      } else if (id === 'empty-input-provenance') {
        await shell.exec("env -S 'envcap'");
        await shell.exec("env -S 'envcap'", { stdin: new Uint8Array() });
        assert.deepEqual(captures.map(row => [row.stdinHex, row.stdinIsDefault]), [['', true], ['', false]]);
      } else if (id === 'nested-shared-command-budget') {
        commands.register({ name: 'bridge', execute: context => context.invoke('env', ['-S', 'envcap']) });
        await assert.rejects(shell.exec('bridge', { limits: { maxCommands: 2 } }), error => error instanceof library.ShellLimitError && error.limit === 'maxCommands');
        assert.equal(captures.length, 0);
        assert.equal((await shell.exec('bridge', { limits: { maxCommands: 3 } })).exitCode, 0);
        assert.equal(captures.length, 1);
      } else if (id === 'cancel-and-late-rejection') {
        let entered, lateReject;
        const ready = new Promise(resolve => { entered = resolve; });
        commands.register({ name: 'pendingcap', execute: context => { assert.equal(context.signal.aborted, false); entered(); return new Promise((_resolve, reject) => { lateReject = reject; }); } });
        const controller = new AbortController(), reason = new Error('holdout-cancel');
        const pending = shell.exec("env -S 'pendingcap'", { signal: controller.signal });
        await Promise.race([ready, pending.then(() => { throw new Error('Pending command unexpectedly completed'); })]); controller.abort(reason);
        await assert.rejects(pending, error => error === reason);
        const unhandled = [];
        const observer = error => unhandled.push(error);
        process.on('unhandledRejection', observer);
        try { lateReject(new Error('late holdout rejection')); await nextTurn(); await nextTurn(); assert.deepEqual(unhandled, []); }
        finally { process.off('unhandledRejection', observer); }
      } else if (id === 'awaited-sink-shared-output-budget') {
        const writes = [];
        const stdout = { async write(bytes) { await nextTurn(); writes.push(Buffer.from(bytes)); } };
        await shell.exec("env -S 'envcap'; printf TAIL", { stdout, limits: { maxOutputBytes: 7 } });
        assert.equal(Buffer.concat(writes).toString(), 'abcTAIL');
        writes.length = 0;
        await assert.rejects(shell.exec("env -S 'envcap'; printf TAIL", { stdout, limits: { maxOutputBytes: 6 } }), error => error instanceof library.ShellLimitError && error.limit === 'maxOutputBytes');
        assert.equal(Buffer.concat(writes).toString(), 'abc');
      } else if (id === 'split-expansion-growth-budget') {
        commands.register({ name: 'bridge', execute: context => context.invoke('env', ['-S', 'envcap ${GROW}'], { replaceEnv: true, env: { GROW: 'x'.repeat(32768) } }) });
        await assert.rejects(shell.exec('bridge', { limits: { maxExpansionBytes: 4096 } }), error => error instanceof library.ShellLimitError && error.limit === 'maxExpansionBytes');
        assert.equal(captures.length, 0);
      }
      return { id, passed: true, observations, captures };
    } finally { await shell.dispose(); }
  });
}
