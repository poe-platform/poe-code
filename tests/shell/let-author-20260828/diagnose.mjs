import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const binding = JSON.parse(readFileSync(process.env.LET_BINDING));
const { Shell, MemoryFileSystem, agentCommands } = await import(pathToFileURL(resolve(binding.root, 'dist/index.js')));
const { Runtime } = await import(pathToFileURL(resolve(binding.root, 'dist/shell/runtime.js')));
const capture = promise => Promise.resolve(promise).then(value => ({ kind: 'return', value }), reason => ({ kind: 'throw', reason }));
const describe = outcome => outcome.kind === 'return' ? { kind: 'return', value: outcome.value } : { kind: 'throw', name: outcome.reason?.name, message: outcome.reason?.message, stack: outcome.reason?.stack, type: typeof outcome.reason };
const deferred = () => { let release; const promise = new Promise(resolvePromise => { release = resolvePromise; }); return { promise, release }; };
const baseline = process.env.LET_DIAG_LAYOUT === 'accepted464';
const observations = [];
const simple = async (id, script, expected) => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  const original = Runtime.prototype.builtin;
  const activations = [];
  Runtime.prototype.builtin = function(context, state, ...rest) {
    if (context.command === 'getopts' || context.command === 'let' || context.command === 'set') activations.push({ command: context.command, functionDepth: state.functionDepth, positional: [...state.positional], args: [...context.args] });
    return original.call(this, context, state, ...rest);
  };
  const receipt = { id, layout: process.env.LET_DIAG_LAYOUT, script, activations };
  try {
    const result = await shell.exec(script); receipt.result = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    assert.deepEqual(receipt.result, expected); receipt.pass = true;
  } catch (error) { receipt.pass = false; receipt.failure = { name: error?.name, message: error?.message }; }
  finally { Runtime.prototype.builtin = original; await shell.dispose(); receipt.disposed = true; }
  observations.push(receipt); console.log(JSON.stringify(receipt));
};
if (baseline) {
  await simple('D01-no-function-arguments-neutral-assignment', 'set -- -ab; getopts ab option; work() { local OPTIND=1; OPTIND=1; getopts ab option; printf "%s\\n" "$option"; }; work; getopts ab option; printf "%s\\n" "$option"', { stdout: '?\nb\n', stderr: '', exitCode: 0 });
  await simple('D02-original-P58-before-LET', 'set -u; let absent', { stdout: '', stderr: 'set: unsupported shell option; supported forms are -e, +e, -- arguments and -o/+o pipefail or errexit\n', exitCode: 2 });
} else {
  await simple('D03-explicit-function-arguments-neighbor', 'set -- -ab; getopts ab option; work() { local OPTIND=1; let \'OPTIND=1\'; getopts ab option; printf "%s\\n" "$option"; }; work "$@"; getopts ab option; printf "%s\\n" "$option"', { stdout: 'a\nb\n', stderr: '', exitCode: 0 });
  await simple('D04-unset-arithmetic-without-unsupported-set', 'let absent', { stdout: '', stderr: '', exitCode: 1 });
}
for (const command of baseline ? [':'] : [':', 'let']) {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const entered = deferred(); const release = deferred(); const events = []; let child; let rootSettled = false;
  shell.use((context, next) => { if (context.command === command) context.registerCleanup(async () => { events.push('cleanup-enter'); entered.release(); await release.promise; events.push('cleanup-done'); }); return next(); });
  shell.register({ name: 'relay', execute(context) { events.push('invoke'); child = capture(context.invoke(command, command === 'let' ? ['1'] : [])); events.push('handler-return'); return { exitCode: 0 }; } });
  const pending = capture(shell.exec('relay')).then(result => { rootSettled = true; events.push('root-settled'); return result; });
  const receipt = { id: `D05-owned-child-${command}`, layout: process.env.LET_DIAG_LAYOUT, events };
  try {
    await Promise.race([entered.promise, pending]); await new Promise(resolveTurn => setImmediate(resolveTurn));
    receipt.pendingBeforeRelease = !rootSettled; assert.equal(rootSettled, false);
    events.push('release'); release.release();
    receipt.child = describe(await child); receipt.root = describe(await pending);
    assert.equal(receipt.root.kind, 'return'); assert.equal(receipt.root.value.exitCode, 0);
    assert(events.indexOf('cleanup-done') < events.indexOf('root-settled'));
    receipt.pass = true;
  } catch (error) { receipt.pass = false; receipt.failure = { name: error?.name, message: error?.message }; }
  finally { release.release(); await child; await pending; await shell.dispose(); receipt.disposed = true; }
  observations.push(receipt); console.log(JSON.stringify(receipt));
}
console.log(JSON.stringify({ summary: { observations: observations.length, qualifiedDiagnoses: observations.filter(row => row.pass).length, disposed: observations.filter(row => row.disposed).length, originalCasesRescored: 0, nativeExecutions: 0 } }));
if (observations.some(row => !row.pass)) process.exitCode = 1;
