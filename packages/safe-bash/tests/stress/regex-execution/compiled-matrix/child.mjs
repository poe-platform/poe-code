import { performance } from 'node:perf_hooks';
import { cases, limits } from '../bounded-matrix/cases.mjs';
import { loadedProof } from './guard.mjs';

const selected = cases.find(item => item.id === process.argv[2]);
if (!selected || process.argv.length !== 3 || typeof process.send !== 'function') throw new Error('Fixed supervisor only');
let command;
try {
  loadedProof(selected, 'before');
  if (selected.tool === 'grep') {
    const { grepCommands } = await import('./.build/js/commands/grep.js');
    command = grepCommands().find(item => item.name === 'grep');
  } else {
    const { rgCommand } = await import('./.build/js/commands/search/rg.js');
    command = rgCommand();
  }
  if (!command) throw new Error('Missing actual command');
} catch (error) {
  process.stderr.write(`setup: ${String(error.message).slice(0, 160)}\n`);
  process.exitCode = 2;
  process.disconnect();
}
if (command) {
  process.send(['ready']);
  process.once('message', async message => {
    if (message !== 'start') throw new Error('Invalid fixed start');
    const controller = new AbortController();
    const startedAt = performance.now();
    const elapsed = () => Number((performance.now() - startedAt).toFixed(3));
    const observation = { calls: 0, enter: null, leave: null, nativeResult: null,
      timerArmed: null, timerDue: null, timerActual: null, signalEntry: null, signalLeave: null,
      signalDelivered: null, commandEnd: null, commandExit: null, commandError: null, signalEnd: null,
      facadeWinner: null, facadeEnd: null, stdout: '', stderr: '' };
    let timer;
    let resolveTimer;
    const timerPromise = new Promise(resolve => { resolveTimer = resolve; });
    const originalExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function observedExec(subject) {
      if (this.source !== selected.source || this.flags !== selected.flags || subject !== selected.subject) {
        return Reflect.apply(originalExec, this, [subject]);
      }
      if (observation.calls !== 0) throw new Error('Second selected native exec forbidden');
      observation.calls++;
      observation.timerArmed = elapsed();
      observation.timerDue = Number((observation.timerArmed + limits.timerMs).toFixed(3));
      timer = setTimeout(() => {
        observation.timerActual = elapsed();
        controller.abort(new Error('Fixed child-local cancellation'));
        observation.signalDelivered = controller.signal.aborted;
        process.send(['cancel', observation.timerActual, observation.signalDelivered]);
        resolveTimer('timer');
      }, limits.timerMs);
      observation.signalEntry = controller.signal.aborted;
      observation.enter = elapsed();
      process.send(['enter', observation.calls, observation.enter, observation.timerArmed, observation.timerDue, observation.signalEntry]);
      try {
        const result = Reflect.apply(originalExec, this, [subject]);
        observation.nativeResult = result === null ? 'null' : 'match';
        return result;
      } finally {
        observation.leave = elapsed();
        observation.signalLeave = controller.signal.aborted;
        process.send(['leave', observation.leave, observation.nativeResult ?? 'throw', observation.signalLeave]);
      }
    };
    const sink = key => ({ async write(bytes) {
      if (Buffer.byteLength(observation[key], 'latin1') + bytes.byteLength > limits.streamBytes) throw new Error('Product output limit');
      observation[key] += Buffer.from(bytes).toString('latin1');
    } });
    const commandPromise = Promise.resolve().then(() => command.execute({
      command: selected.tool, args: selected.args, cwd: '/', env: {},
      stdin: (async function* fixedInput() { yield Buffer.from(selected.subject, 'ascii'); })(),
      stdinIsDefault: false, stdout: sink('stdout'), stderr: sink('stderr'),
      fs: Object.freeze({}), signal: controller.signal,
    })).then(result => { observation.commandExit = result.exitCode; }, error => {
      observation.commandError = String(error.message).slice(0, 120);
    }).then(() => {
      observation.commandEnd = elapsed();
      observation.signalEnd = controller.signal.aborted;
      RegExp.prototype.exec = originalExec;
      return 'command';
    });
    observation.facadeWinner = await Promise.race([commandPromise, timerPromise]);
    observation.facadeEnd = elapsed();
    await commandPromise;
    if (observation.calls) await timerPromise;
    clearTimeout(timer);
    loadedProof(selected, 'after');
    const output = JSON.stringify(observation) + '\n';
    if (Buffer.byteLength(output) > limits.streamBytes) throw new Error('Observation output limit');
    await new Promise((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
    process.exitCode = observation.calls === selected.expected.calls
      && observation.nativeResult === selected.expected.nativeResult
      && observation.commandExit === selected.expected.exitCode && observation.commandError === null
      && observation.stdout === selected.expected.stdout && observation.stderr === selected.expected.stderr ? 0 : 1;
    await new Promise((resolve, reject) => process.send(['done'], error => error ? reject(error) : resolve()));
    process.disconnect();
  });
}
