import { readFileSync } from 'node:fs';
import { assert, create, exactResult, encode, outcome, record, deferred, turn, quote, commandCase, cases, watchBuiltin, mergeEvents, patternFixture, patternAbort, expectLimit, realFixture } from './support.mjs';
import { globCase } from '../execution-prep-v1/cohorts.mjs';
import { hash } from '../execution-prep-v1/artifacts.mjs';
import { classify } from '../execution-prep-v1/protocol.mjs';

const visible = ['dir', 'v', 'visible', '雪'];
const all = ['.dir', '.hidden', '.x', '.雪', ...visible];
const ordinaryOn = 'dotglob             \ton\n';
const unknown = name => `shell: line 1: shopt: ${name}: unsupported shell option name (only dotglob is supported)\n`;
const ok = (result, stdout = '', exitCode = 0, stderr = '') => exactResult(result, { stdout, stderr, exitCode });
export const adapters = {
  async R01({ api, resources, check }) {
    const current = await create(api, resources);
    ok(await current.shell.exec('listing() { capture *; }; listing; shopt -s dotglob; listing; shopt -u dotglob; listing'));
    check('call-time-off-on-off', current.calls, [visible, all, visible]);
  },
  async R02({ api, resources, check }) {
    const first = await create(api, resources), entered = deferred(resources), release = deferred(resources);
    ok(await first.shell.exec('shopt -s dotglob'));
    const fresh = await first.shell.exec('shopt -q dotglob'); ok(fresh, '', 1);
    check('same-shell-new-exec', fresh.exitCode, 1);
    const second = await create(api, resources, { shell: { fs: first.fs } });
    first.shell.register({ name: 'gate', async execute(context) { context.registerCleanup(() => release.resolve()); entered.resolve(); await release.promise; return { exitCode: 0 }; } });
    const pending = resources.track(first.shell.exec('shopt -s dotglob; gate; capture *'));
    await entered.promise; ok(await second.shell.exec('capture *')); release.resolve(); ok(await pending);
    check('overlapping-isolated-shells', [first.calls, second.calls], [[all], [visible]]);
  },
  async R03({ api, resources, check }) {
    const current = await create(api, resources, { shell: { env: { LC_ALL: 'C', TZ: 'UTC', BASHOPTS: 'dotglob', SHELLOPTS: 'dotglob', GLOBIGNORE: '*', dotglob: 'on' } } });
    ok(await current.shell.exec('shopt -q dotglob; capture *'));
    check('virtual-environment-does-not-enable', current.calls, [visible]);
    const child = [];
    current.shell.register({ name: 'relay', async execute(context) { child.push(await context.invoke('shopt', ['-q', 'dotglob'], { replaceEnv: true, env: {} })); return { exitCode: 0 }; } });
    ok(await current.shell.exec('shopt -s dotglob; relay; shopt -q dotglob'));
    check('replacement-retains-clone-state', child.map(value => value.exitCode), [0]);
  },
  async R04({ api, resources, check }) {
    const current = await create(api, resources);
    const result = await current.shell.exec('shopt -s dotglob; { shopt -q dotglob; printf "left:%s\\n" "$?"; shopt -u dotglob; } | { shopt -q dotglob; printf "right:%s\\n" "$?"; cat; }; shopt -q dotglob; printf "parent:%s\\n" "$?"');
    ok(result, 'right:0\nleft:0\nparent:0\n');
    check('each-pipeline-stage-inherits', result.stdout.split('\n').slice(0, 2), ['right:0', 'left:0']);
    check('stage-mutation-isolated', result.stdout.split('\n')[2], 'parent:0');
  },
  async R05({ api, resources, check }) {
    const current = await create(api, resources), results = [], invalid = [], options = [];
    current.shell.register({ name: 'inspect', execute(context) { options.push({ cwd: context.cwd, env: { ...context.env } }); return { exitCode: 0 }; } });
    current.shell.register({ name: 'relay', async execute(context) {
      results.push((await context.invoke('shopt', ['-q', 'dotglob'])).exitCode);
      results.push((await context.invoke('flip', [])).exitCode);
      results.push((await context.invoke('shopt', ['-q', 'dotglob'])).exitCode);
      results.push((await context.invoke('shopt', ['*'])).exitCode);
      for (const [name, args] of [['shopt', ['\0']], ['shopt', [17]], ['shopt\0', []]]) invalid.push(await outcome(context.invoke(name, args)));
      await context.invoke('inspect', [], { cwd: '/g/dir', env: { ONLY: 'virtual' }, replaceEnv: true });
      const controller = new AbortController(); controller.abort(false);
      invalid.push(await outcome(context.invoke('shopt', ['-s', 'dotglob'], { signal: controller.signal })));
      return { exitCode: 0 };
    } });
    const result = await current.shell.exec('flip() { shopt -u dotglob; shopt -q dotglob; }; shopt -s dotglob; relay; shopt -q dotglob');
    ok(result, '', 0, unknown('*'));
    check('invoke-clone', results.slice(0, 3), [0, 1, 0]);
    check('literal-argv', results[3], 1);
    check('nul-and-type-admission', invalid.slice(0, 3).map(value => value.kind === 'throw' && value.reason instanceof TypeError), [true, true, true]);
    assert.equal(invalid[3].kind, 'throw'); assert.ok(Object.is(invalid[3].reason, false));
    check('shared-options-signal-budget', { options, localReason: invalid[3].reason, rootStatus: result.exitCode }, { options: [{ cwd: '/g/dir', env: { ONLY: 'virtual' } }], localReason: false, rootStatus: 0 });
  },
  async R06({ api, resources, check }) {
    const current = await create(api, resources);
    await current.fs.writeFile('/g/bad', encode('shopt -s dotglob; touch /g/marker\nif'));
    const result = await current.shell.exec('bash /g/bad');
    ok(result, '', 2, '/g/bad: line 2: syntax error: Expected nonempty compound list\n');
    check('scriptFile-whole-input-preflight', result.exitCode, 2);
    const marker = await outcome(current.fs.stat('/g/marker'));
    check('late-syntax-no-leading-effects', marker.kind === 'throw' && marker.reason.code, 'ENOENT');
  },
  async R07({ api, resources, check }) {
    const current = await create(api, resources), script = 'shopt -q dotglob; printf "%s\\n" "$?"';
    await current.fs.writeFile('/g/file', encode(script));
    await current.fs.writeFile('/g/bash-file', encode('#!/bin/bash\n' + script)); await current.fs.chmod('/g/bash-file', 0o755);
    const outputs = [];
    for (const [command, options] of [[`bash -c ${quote(script)}`, {}], [`sh -c ${quote(script)}`, {}], ['bash -s', { stdin: script }], ['bash /g/file', {}], ['/g/bash-file', {}]]) {
      const result = await current.shell.exec(`shopt -s dotglob; ${command}; shopt -q dotglob; printf "%s\\n" "$?"`, options); ok(result, '1\n0\n'); outputs.push(result.stdout);
    }
    check('bound-interpreter-entry-routes-fresh', outputs, Array(5).fill('1\n0\n'));
    await current.fs.writeFile('/g/enable', encode('shopt -s dotglob'));
    ok(await current.shell.exec('. /g/enable; shopt -q dotglob; eval "shopt -u dotglob"; shopt -q dotglob'), '', 1);
    check('source-eval-share', (await current.shell.exec('. /g/enable; shopt -q dotglob')).exitCode, 0);
    const clones = await current.shell.exec('shopt -s dotglob; (shopt -u dotglob); ignored=$(shopt -u dotglob); shopt -q dotglob'); ok(clones);
    check('subshell-substitution-clone', clones.exitCode, 0);
  },
  async R08({ api, resources, manifest, check }) {
    check('default-inventory-unchanged', api.createAgentCommands().map(command => command.name).sort(), manifest.binding.defaultNames);
    const current = await create(api, resources); let spy = 0;
    current.shell.register({ name: 'shopt', execute() { spy++; return { exitCode: 99 }; } });
    const discover = await current.shell.exec('type -t shopt; command -v shopt; type shopt; command -V shopt; type -a shopt');
    const expected = 'builtin\nshopt\nshopt is a shell builtin\nshopt is a shell builtin\nshopt is a shell builtin\n';
    ok(discover, expected);
    check('discovery', discover.stdout, expected);
    const result = await current.shell.exec('shopt() { printf function; return 7; }; shopt; printf ":%s\\n" "$?"; command shopt -s dotglob; command shopt -q dotglob');
    ok(result, 'function:7\n'); check('function-precedence-command-bypass', result.stdout, 'function:7\n');
    check('registry-collision', spy, 0);
  },
  async R09({ api, resources, check }) {
    const current = await create(api, resources);
    const disabled = await current.shell.exec('set -e; shopt -q dotglob; printf late'); ok(disabled, '', 1);
    check('errexit-named-disabled', disabled.exitCode, 1);
    const guarded = await current.shell.exec('set -e; shopt -q dotglob || printf guarded; ! shopt -q dotglob; shopt -q dotglob && printf late; printf end'); ok(guarded, 'guardedend');
    check('guarded-control-status', guarded.stdout, 'guardedend');
    const noName = await current.shell.exec('set -e; shopt -s; printf done'); ok(noName, 'done'); check('no-name-zero', noName.exitCode, 0);
    const bad = await current.shell.exec('set -e; shopt -z dotglob; printf late');
    ok(bad, '', 2, 'shell: line 1: shopt: -z: unsupported option\nshopt: usage: shopt [-pqsu] [--] [dotglob ...]\n');
    check('invalid-flag-two', bad.exitCode, 2);
  },
  async R10({ api, Runtime, resources, check }) {
    const current = await create(api, resources), events = [], watcher = watchBuiltin(Runtime, resources);
    const result = await current.shell.exec('shopt -s dotglob; shopt dotglob bad dotglob bad', { stdout: { async write(bytes) { events.push(['stdout', Buffer.from(bytes).toString()]); } }, stderr: { async write(bytes) { events.push(['stderr', Buffer.from(bytes).toString()]); } } });
    ok(result, ordinaryOn.repeat(2), 1, unknown('bad').repeat(2));
    check('ordered-channel-events', mergeEvents(events), [['stdout', ordinaryOn], ['stderr', unknown('bad')], ['stdout', ordinaryOn], ['stderr', unknown('bad')]]);
    check('duplicates', [result.stdout, result.stderr], [ordinaryOn.repeat(2), unknown('bad').repeat(2)]);
    const observed = [];
    for (const args of ['-s dotglob bad', '-s bad dotglob']) {
      const gate = deferred(resources), entered = deferred(resources); let active;
      const pending = resources.track(current.shell.exec('shopt ' + args, { stderr: { async write() { active = await watcher.query(); entered.resolve(); await gate.promise; } } }));
      await entered.promise; observed.push(active); gate.resolve(); await pending;
    }
    check('valid-unknown-order-no-rollback', observed, [0, 1]);
    check('gated-diagnostics', observed.length, 2);
  },
  async R11({ api, resources, check }) {
    const rows = cases().commands.filter(row => row.args.includes('-su') || row.args.includes('--help') || row.args.join(' ') === 'dotglob -z');
    assert.ok(rows.length > 0);
    const results = [];
    for (const row of rows) results.push(await commandCase(api, row, resources));
    check('invalid-before-conflict-before-operands', results.map(value => value.receipts[0][0]), rows.map(row => String(row.exitCode)));
    const later = cases().overlay.filter(row => row.exitCode === 1);
    for (const row of later) await commandCase(api, row, resources);
    check('later-flag-is-name', later.map(row => row.exitCode), [1, 1]);
    check('no-vfs-access', results.flatMap(value => value.events), []);
  },
  async R12({ api, resources, check }) {
    const current = await create(api, resources), reasons = [{ marker: 'caller' }, new Error('caller'), new api.FsError('ECANCELED'), null, false, 0, '', Symbol('caller')], identities = [];
    for (const reason of reasons) for (const script of ['shopt -q dotglob', 'shopt -s dotglob', 'capture *']) {
      const controller = new AbortController(); controller.abort(reason);
      const captured = await outcome(current.shell.exec(script, { signal: controller.signal }));
      assert.equal(captured.kind, 'throw'); identities.push(Object.is(captured.reason, reason));
    }
    check('all-eight-reason-identities', identities, Array(24).fill(true));
    check('no-preabort-dispatch', [current.calls, current.events], [[], []]);
  },
  async R13({ api, resources, check }) {
    const rows = [];
    for (const method of ['readdir', 'stat']) {
      const current = await create(api, resources), controller = new AbortController(), reason = { method }, entered = deferred(resources), release = deferred(resources);
      const original = current.fs[method].bind(current.fs); let signal;
      current.fs[method] = async (path, options) => { signal = options?.signal; entered.resolve(); await release.promise; signal.throwIfAborted(); return original(path, options); };
      const pending = resources.track(outcome(current.shell.exec('shopt -s dotglob; capture *', { signal: controller.signal })));
      await entered.promise; controller.abort(reason); release.resolve(); const captured = await pending;
      assert.equal(captured.kind, 'throw'); assert.ok(Object.is(captured.reason, reason)); assert.equal(signal.aborted, true); assert.deepEqual(current.calls, []);
      rows.push({ method, exact: true, dispatched: current.calls.length });
    }
    check('readdir-abort', rows[0], { method: 'readdir', exact: true, dispatched: 0 });
    check('stat-abort', rows[1], { method: 'stat', exact: true, dispatched: 0 });
    check('propagated-signal-no-successful-late-effects', rows.map(row => row.dispatched), [0, 0]);
  },
  async R14({ api, Runtime, resources, manifest, check }) {
    const observed = await patternAbort(api, Runtime, resources, manifest, 'shopt -s dotglob; ');
    check('actual-pattern-checkpoint-hit', observed.hits > 0, true);
    check('caller-reason-identity', observed.reasonIdentity, true);
    check('bounded-fixture', observed.names.every(name => [...name].length <= 64) && observed.names.length <= 128 && observed.pattern.length === 34, true);
  },
  async R15({ api, resources, check }) {
    const rows = [];
    for (const [state, cap, expected] of [['off', 5, visible], ['on', 9, all]]) for (const delta of [0, -1]) {
      const current = await create(api, resources);
      const captured = await outcome(current.shell.exec((state === 'on' ? 'shopt -s dotglob; ' : '') + 'capture *', { limits: { maxExpansionFields: cap + delta } }));
      if (delta === 0) { assert.equal(captured.kind, 'result'); ok(captured.value); assert.deepEqual(current.calls, [expected]); }
      else { expectLimit(api, captured, 'maxExpansionFields'); assert.deepEqual(current.calls, []); }
      rows.push({ state, cap: cap + delta, kind: captured.kind });
    }
    check('off-five-allow-four-reject', rows.slice(0, 2), [{ state: 'off', cap: 5, kind: 'result' }, { state: 'off', cap: 4, kind: 'throw' }]);
    check('on-nine-allow-eight-reject', rows.slice(2), [{ state: 'on', cap: 9, kind: 'result' }, { state: 'on', cap: 8, kind: 'throw' }]);
    check('typed-field-limit-before-dispatch', rows.filter(row => row.kind === 'throw').length, 2);
  },
  async R16({ api, resources, check }) {
    const rows = [];
    for (const [state, cap, expected] of [['off', 14, visible], ['on', 31, all]]) for (const delta of [0, -1]) {
      const current = await create(api, resources);
      const captured = await outcome(current.shell.exec((state === 'on' ? 'shopt -s dotglob; ' : '') + 'capture *', { limits: { maxExpansionBytes: cap + delta } }));
      if (delta === 0) { assert.equal(captured.kind, 'result'); ok(captured.value); assert.deepEqual(current.calls, [expected]); }
      else { expectLimit(api, captured, 'maxExpansionBytes'); assert.deepEqual(current.calls, []); }
      rows.push([cap + delta, captured.kind]);
    }
    check('off-fourteen-thirteen', rows.slice(0, 2), [[14, 'result'], [13, 'throw']]);
    check('on-thirtyone-thirty', rows.slice(2), [[31, 'result'], [30, 'throw']]);
    check('typed-byte-limit-before-dispatch', rows.filter(row => row[1] === 'throw').length, 2);
  },
  async R17({ api, resources, check }) {
    const current = await create(api, resources), boundaries = [];
    for (const [script, cap, text] of [['shopt', 25, 'dotglob             \toff\n'], ['shopt -s dotglob; shopt', 24, ordinaryOn], ['shopt -p', 17, 'shopt -u dotglob\n']]) {
      const good = await current.shell.exec(script, { limits: { maxOutputBytes: cap } }); ok(good, text);
      const bad = await outcome(current.shell.exec(script, { limits: { maxOutputBytes: cap - 1 } })); expectLimit(api, bad, 'maxOutputBytes');
      boundaries.push([good.stdoutBytes.length, bad.reason.limit]);
    }
    check('ordinary-and-reusable-byte-boundaries', boundaries, [[25, 'maxOutputBytes'], [24, 'maxOutputBytes'], [17, 'maxOutputBytes']]);
    const silent = [];
    for (const [script, status] of [['shopt -q dotglob', 1], ['shopt -s dotglob', 0], ['shopt -u dotglob', 0]]) { const result = await current.shell.exec(script, { limits: { maxOutputBytes: 0 } }); ok(result, '', status); silent.push(result.exitCode); }
    check('silent-zero-cap', silent, [1, 0, 0]);
    const diagnostic = await outcome(current.shell.exec('shopt bad', { limits: { maxOutputBytes: 0 } })); expectLimit(api, diagnostic, 'maxOutputBytes');
    check('diagnostic-zero-cap-limit', diagnostic.reason.limit, 'maxOutputBytes');
  },
  async R18({ api, resources, check }) {
    const outputs = [];
    for (const [state, cap] of [['off', 34], ['on', 600], ['on', 34]]) {
      const current = await patternFixture(api, resources, 'hidden');
      const captured = await outcome(current.shell.exec((state === 'on' ? 'shopt -s dotglob; ' : '') + 'capture ' + current.pattern, { limits: { maxExpansionBytes: cap } }));
      if (state === 'on' && cap === 34) { expectLimit(api, captured, 'maxExpansionBytes'); assert.deepEqual(current.calls, []); }
      else { assert.equal(captured.kind, 'result'); ok(captured.value); assert.deepEqual(current.calls, [[current.pattern]]); }
      outputs.push([state, cap, captured.kind]);
    }
    check('bound-work-positive', outputs[1], ['on', 600, 'result']);
    check('bound-work-exhaustion', outputs[2], ['on', 34, 'throw']);
    check('off-controls-accounting-retained', outputs[0], ['off', 34, 'result']);
  },
  async R19({ api, Runtime, resources, check }) {
    const watcher = watchBuiltin(Runtime, resources), outcomes = [], retained = [];
    const scenarios = [
      ['maxCommands', 'shopt -s dotglob; relay', { maxCommands: 2 }],
      ['maxSourceBytes', "shopt -s dotglob; eval 'printf x'", null],
      ['maxSubstitutionDepth', 'inner() { :; }; outer() { inner; }; shopt -s dotglob; outer', { maxSubstitutionDepth: 1 }],
      ['maxLoopIterations', 'shopt -s dotglob; for item in 1 2; do :; done', { maxLoopIterations: 1 }],
    ];
    for (const [limit, script, configured] of scenarios) {
      const current = await create(api, resources);
      current.shell.register({ name: 'relay', async execute(context) { try { return await context.invoke('shopt', ['-q', 'dotglob']); } catch { return { exitCode: 0 }; } } });
      const start = watcher.records.length;
      const captured = await outcome(current.shell.exec(script, { limits: configured ?? { maxSourceBytes: Buffer.byteLength(script) } }));
      expectLimit(api, captured, limit); outcomes.push(captured.reason.limit);
      const records = watcher.records.splice(0, start);
      retained.push(watcher.retainedEnabled().enabled);
      watcher.records.unshift(...records);
    }
    check('nested-shared-command-limit', outcomes[0], 'maxCommands');
    check('source-depth-loop-limits', outcomes.slice(1), ['maxSourceBytes', 'maxSubstitutionDepth', 'maxLoopIterations']);
    check('earlier-effects-retained', retained, [true, true, true, true]);
  },
  async R20({ api, Runtime, resources, check }) {
    const current = await create(api, resources), watcher = watchBuiltin(Runtime, resources), statuses = [];
    const listed = [];
    const stdout = await current.shell.exec('shopt -s dotglob; shopt dotglob dotglob', { stdout: { async write(bytes) { listed.push(Buffer.from(bytes).toString()); throw new Error('dg-stdout'); } } });
    assert.equal(stdout.exitCode, 1); assert.equal(stdout.stderr, 'shell: line 1: dg-stdout\n');
    check('stdout-failure-stops-later-operands', listed, [ordinaryOn]);
    for (const [script, expected] of [['shopt -s bad dotglob', 1], ['shopt -s dotglob bad', 0]]) {
      let queried;
      const events = [];
      const result = await current.shell.exec(script, { stderr: { async write(bytes) {
        events.push(Buffer.from(bytes).toString());
        if (events.length === 1) { queried = await watcher.query(); throw new Error('dg-stderr'); }
      } } });
      assert.equal(queried, expected); assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, unknown('bad') + 'shell: line 1: dg-stderr\n');
      assert.equal(watcher.enabledState(), expected === 0, 'post-failure state, not only the state before sink rejection');
      statuses.push(queried);
    }
    check('stderr-unknown-first-no-later-mutation', statuses[0], 1);
    check('valid-first-mutation-retained', statuses[1], 0);
    check('base-error-mapping', { stdoutStatus: stdout.exitCode, stderrStatuses: statuses }, { stdoutStatus: 1, stderrStatuses: [1, 0] });
  },
  async R21({ api, resources, check }) {
    const waits = [];
    for (const channel of ['stdout', 'stderr']) {
      const current = await create(api, resources), entered = deferred(resources), release = deferred(resources); let settled = false;
      const pending = resources.track(current.shell.exec(channel === 'stdout' ? 'shopt' : 'shopt bad', { [channel]: { async write() { entered.resolve(); await release.promise; } } }).then(value => { settled = true; return value; }));
      await entered.promise; await turn(); waits.push(settled); release.resolve(); await pending;
    }
    check('stdout-stderr-backpressure', waits, [false, false]);
    const precedence = [], retirements = [];
    for (const mode of ['cleanup', 'budget', 'caller']) {
      const current = await create(api, resources), controller = new AbortController(), cleanup = new Error('dg-cleanup'); let retired = 0;
      current.shell.register({ name: 'owned', async execute(context) {
        context.registerCleanup(async () => { retired++; if (mode === 'caller') controller.abort(false); throw cleanup; });
        if (mode !== 'cleanup') return context.invoke('shopt', ['-q', 'dotglob']);
        return { exitCode: 0 };
      } });
      const captured = await outcome(current.shell.exec('shopt -s dotglob; owned', { signal: controller.signal, limits: { maxCommands: 2 } }));
      assert.equal(captured.kind, 'throw'); retirements.push(retired);
      if (mode === 'cleanup') { assert.equal(captured.reason, cleanup); precedence.push('cleanup'); }
      if (mode === 'budget') { expectLimit(api, captured, 'maxCommands'); precedence.push('execution-control'); }
      if (mode === 'caller') { assert.ok(Object.is(captured.reason, false)); precedence.push('caller'); }
    }
    const gated = await create(api, resources), entered = deferred(resources), release = deferred(resources);
    let rootSettled = false, disposeSettled = false, closed = 0;
    gated.shell.register({ name: 'ownedgate', execute(context) { context.registerCleanup(async () => { closed++; entered.resolve(); await release.promise; }); return { exitCode: 0 }; } });
    const root = resources.track(outcome(gated.shell.exec('shopt -s dotglob; ownedgate')).then(value => { rootSettled = true; return value; }));
    await entered.promise;
    const disposal = resources.track(gated.shell.dispose().then(() => { disposeSettled = true; }));
    await turn(); assert.equal(rootSettled, false); assert.equal(disposeSettled, false);
    release.resolve(); const disposedRoot = await root; await disposal;
    assert.equal(disposedRoot.kind, 'throw'); assert.equal(String(disposedRoot.reason), 'Error: Shell is disposed');
    check('registered-cleanup-drained-once', { retirements, gate: [closed, rootSettled, disposeSettled] }, { retirements: [1, 1, 1], gate: [1, true, true] });
    check('caller-execution-cleanup-precedence', precedence, ['cleanup', 'execution-control', 'caller']);
    const children = [], unhandled = [];
    const listener = reason => unhandled.push(String(reason)); process.on('unhandledRejection', listener); resources.restore(() => process.off('unhandledRejection', listener));
    for (const command of [':', 'shopt']) {
      const current = await create(api, resources); let child, retired = 0;
      current.shell.register({ name: 'owned', execute(context) { context.registerCleanup(() => { retired++; }); child = outcome(context.invoke(command, command === 'shopt' ? ['-q', 'dotglob'] : [])); return { exitCode: 0 }; } });
      const root = await current.shell.exec('shopt -s dotglob; owned'); ok(root); const nested = await child; await turn();
      assert.equal(retired, 1);
      if (nested.kind === 'throw') assert.equal(String(nested.reason), 'Error: Invocation is closed');
      else assert.equal(nested.value.exitCode, 0);
      children.push({ command, root: root.exitCode, retired, observed: true });
    }
    assert.deepEqual(unhandled, []);
    check('unawaited-child-colon-comparator-no-unhandled', children.map(row => [row.root, row.retired, row.observed]), [[0, 1, true], [0, 1, true]]);
  },
  async R22({ api, resources, check }) {
    const current = await create(api, resources, { fixture: 'dot-entries' });
    ok(await current.shell.exec('shopt -s dotglob; capture *'));
    check('provider-order-final-sort', current.calls, [['..keep', '.hidden', 'visible']]);
    check('custom-dot-entries', current.events.filter(event => event.method === 'stat').map(event => event.path), ['/g/visible', '/g/.hidden', '/g/..keep']);
    const rows = [];
    for (const method of ['readdir', 'stat']) for (const code of ['ENOENT', 'ENOTDIR', 'EACCES', 'EIO', 'ECANCELED']) {
      const target = await create(api, resources), original = target.fs[method].bind(target.fs);
      target.fs[method] = async (path, options) => { if (method === 'readdir' && path === '/g' || method === 'stat' && path === '/g/.hidden') throw new api.FsError(code, 'bound-provider', path); return original(path, options); };
      const result = await target.shell.exec('shopt -s dotglob; capture .hidden*');
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(code)) { ok(result); assert.deepEqual(target.calls, [['.hidden*']]); }
      else { assert.equal(result.exitCode, 1); assert.deepEqual(target.calls, []); assert.equal(result.stderr, `shell: line 1: ${code}: ${code === 'EIO' ? 'input/output error' : 'operation canceled'}\n`); }
      rows.push(result.exitCode);
    }
    check('swallowed-vs-propagated-errno', rows, [0, 0, 0, 1, 1, 0, 0, 0, 1, 1]);
  },
  async R23({ api, resources, check }) {
    const rows = cases().overlay, actual = [];
    for (const row of rows) actual.push((await commandCase(api, row, resources)).receipts[0]);
    check('six-offending-z-preflight-rows', actual.filter((_, index) => rows[index].exitCode === 2), rows.filter(row => row.exitCode === 2).map(row => ['2', row.initial === 'on' ? '0' : '1']));
    check('two-later-cluster-name-neighbors', actual.filter((_, index) => rows[index].exitCode === 1), [['1', '0'], ['1', '0']]);
  },
  async R24({ manifest, check }) {
    const { verifyWorkflow } = await import('./guards.mjs');
    const proof = verifyWorkflow(manifest);
    for (const [name, actual, expected] of proof) check(name, actual, expected);
  },
  async R25({ api, resources, check }) {
    const current = await create(api, resources);
    await current.fs.writeFile('/g/line.sh', encode('\nshopt bad\n'));
    const sourced = await current.shell.exec('. /g/line.sh');
    ok(sourced, '', 1, '/g/line.sh: line 2: shopt: bad: unsupported shell option name (only dotglob is supported)\n');
    check('source-line-two', sourced.stderr.startsWith('/g/line.sh: line 2:'), true);
    const rows = [];
    for (const script of ['fn() { shopt bad; }; fn', "eval 'shopt bad'"]) { const result = await current.shell.exec(script); ok(result, '', 1, unknown('bad')); rows.push(result.stderr); }
    check('function-eval-diagnostics', rows, [unknown('bad'), unknown('bad')]);
    await current.fs.writeFile('/g/input', encode('file-input'));
    let received = '';
    current.shell.register({ name: 'consume', async execute(context) { for await (const chunk of context.stdin) received += Buffer.from(chunk).toString(); return { exitCode: 0 }; } });
    ok(await current.shell.exec('shopt -q dotglob < /g/input; consume', { stdin: 'external-input' }));
    check('redirection-and-stdin-not-consumed', [received, Buffer.from(await current.fs.readFile('/g/input')).toString()], ['external-input', 'file-input']);
  },
  async R26({ api, resources, manifest, check }) {
    const rows = cases().globs.filter(row => ['dot-entries', 'empty-dot-entries'].includes(row.fixture) || row.word === '.' || row.word === '..');
    for (const row of rows) await globCase(api, row, resources);
    check('literal-dot-dotdot', rows.filter(row => row.word === '.' || row.word === '..').length > 0, true);
    check('wildcard-dot-omission-both-states', new Set(rows.filter(row => row.word === '.*').map(row => row.state)).size, 2);
    check('dotdotkeep-preserved', rows.some(row => row.expectedArgs.includes('..keep')), true);
    const current = await realFixture(api, resources, manifest, 'candidate-real');
    ok(await current.shell.exec('shopt -s dotglob; capture *; capture ..'));
    check('configured-realfs-positive-refusal', { calls: current.calls, code: current.refusal.code }, { calls: [['..keep', '.hidden', 'visible'], ['..']], code: 'EACCES' });
  },
};
