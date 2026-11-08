import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fixedCase, productFiles } from './fixed-case.mjs';

if (process.argv.length !== 2 || typeof process.send !== 'function') {
  throw new Error('Only the fixed supervisor may launch this child');
}
const mappings = new Map();
for (const path of productFiles) {
  const target = new URL(`../../../../src/${path}`, import.meta.url).href;
  mappings.set(target, target);
  mappings.set(target.slice(0, -3) + '.js', target);
}
const builtins = new Set(['node:path', 'node:util', 'node:stream/web']);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (builtins.has(specifier)) return nextResolve(specifier, context);
    const target = mappings.get(new URL(specifier, context.parentURL).href);
    if (!target) throw new Error('Import outside the fixed product closure');
    return nextResolve(target, context);
  },
});
let command;
try {
  const { grepCommands } = await import('../../../../src/commands/grep.ts');
  command = grepCommands().find(definition => definition.name === 'grep');
  if (!command) throw new Error('Missing actual grep definition');
} catch (error) {
  process.stderr.write(`setup: ${String(error.message).slice(0, 160)}\n`);
  process.exitCode = 2;
  process.disconnect();
}
hooks.deregister();

if (command) {
  process.send('ready');
  process.once('message', async message => {
    if (message !== 'start') throw new Error('Invalid fixed start');
    const controller = new AbortController();
    const startedAt = performance.now();
    const elapsed = () => Number((performance.now() - startedAt).toFixed(3));
    const observation = {
      calls: 0, enter: null, leave: null, nativeNull: null,
      abortAtEntry: null, abortAtLeave: null, timerArmed: null, cancel: null,
      commandEnd: null, commandExit: null, commandAborted: null,
      productOutBytes: 0, productErrBytes: 0,
    };
    let timer;
    let resolveCancellation;
    const cancellation = new Promise(resolve => { resolveCancellation = resolve; });
    const originalExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function observedExec(subject) {
      if (this.source !== fixedCase.pattern || this.flags !== fixedCase.flags
        || subject !== fixedCase.subject) return Reflect.apply(originalExec, this, [subject]);
      if (observation.calls !== 0) throw new Error('A second selected exec is forbidden');
      observation.calls += 1;
      observation.timerArmed = elapsed();
      timer = setTimeout(() => {
        observation.cancel = elapsed();
        controller.abort(new Error('Fixed child-local cancellation'));
        process.send('cancel');
        resolveCancellation();
      }, fixedCase.childDeadlineMs);
      observation.abortAtEntry = controller.signal.aborted;
      observation.enter = elapsed();
      process.send('enter');
      const result = Reflect.apply(originalExec, this, [subject]);
      observation.leave = elapsed();
      process.send('leave');
      observation.abortAtLeave = controller.signal.aborted;
      observation.nativeNull = result === fixedCase.expectedNativeResult;
      return result;
    };
    const sink = key => ({
      async write(bytes) {
        observation[key] += bytes.byteLength;
        if (observation[key] > 1024) throw new Error('Product output limit');
      },
    });
    try {
      const result = await command.execute({
        command: 'grep', args: ['-E', fixedCase.pattern], cwd: '/', env: {},
        stdin: (async function* fixedInput() { yield Buffer.from(fixedCase.subject, 'ascii'); })(),
        stdinIsDefault: false,
        stdout: sink('productOutBytes'), stderr: sink('productErrBytes'),
        fs: Object.freeze({}), signal: controller.signal,
      });
      observation.commandExit = result.exitCode;
      observation.commandAborted = controller.signal.aborted;
    } catch (error) {
      observation.commandAborted = controller.signal.aborted;
      process.stderr.write(`command: ${String(error.message).slice(0, 160)}\n`);
    } finally {
      observation.commandEnd = elapsed();
      RegExp.prototype.exec = originalExec;
    }
    if (observation.calls === 1) await cancellation;
    clearTimeout(timer);
    const output = JSON.stringify(observation) + '\n';
    if (Buffer.byteLength(output) > 1024) throw new Error('Observation output limit');
    await new Promise((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
    process.exitCode = observation.calls === 1 && observation.nativeNull === true
      && observation.commandExit === fixedCase.expectedExitCode
      && observation.productOutBytes === 0 && observation.productErrBytes === 0 ? 0 : 1;
    await new Promise((resolve, reject) => process.send('done', error => error ? reject(error) : resolve()));
    process.disconnect();
  });
}
