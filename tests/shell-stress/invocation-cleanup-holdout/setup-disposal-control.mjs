import { pathToFileURL } from 'node:url';

const { Shell, MemoryFileSystem } = await import(pathToFileURL(process.argv[2]).href);
const observations = [];
const outcome = async promise => {
  try { return { rejected: false, value: await promise }; }
  catch (reason) { return { rejected: true, reason }; }
};

{
  const events = [];
  const setupFailure = new Error('explicit setup failure');
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.use({ name: 'first', setup() { events.push('first-setup'); }, dispose() { events.push('first-dispose'); } });
  shell.use({ name: 'failing', setup() { events.push('failing-setup'); throw setupFailure; }, dispose() { events.push('failing-dispose'); } });
  const execution = await outcome(shell.exec(':'));
  const disposal = await outcome(shell.dispose());
  observations.push({ id: 'D1-explicit-setup-rejection', execRejected: execution.rejected, exactSetupReason: execution.reason === setupFailure, disposeRejected: disposal.rejected, events });
}

{
  const events = [];
  let ownedLease = false;
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.use({ name: 'queued-middleware-plugin', setup(host) {
    events.push('setup-start');
    ownedLease = true;
    host.use((_context, next) => next());
    events.push('middleware-installed');
  }, dispose() { events.push('plugin-dispose'); ownedLease = false; } });
  const disposal = await outcome(shell.dispose());
  observations.push({ id: 'D2-queued-setup-immediate-dispose', disposeRejected: disposal.rejected, events, ownedLeaseAfterDispose: ownedLease });
}

{
  const events = [];
  const disposeFailure = new Error('explicit plugin disposal failure');
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.use({ name: 'first', setup() { events.push('first-setup'); }, dispose() { events.push('first-dispose'); } });
  shell.use({ name: 'second', setup() { events.push('second-setup'); }, dispose() { events.push('second-dispose'); throw disposeFailure; } });
  const execution = await shell.exec(':');
  const disposal = await outcome(shell.dispose());
  observations.push({ id: 'D3-completed-setup-dispose-failure', execStatus: execution.exitCode, stdoutHex: Buffer.from(execution.stdoutBytes).toString('hex'), stderrHex: Buffer.from(execution.stderrBytes).toString('hex'), disposeRejected: disposal.rejected, aggregate: disposal.reason instanceof AggregateError, oneExactFailure: disposal.reason?.errors?.length === 1 && disposal.reason.errors[0] === disposeFailure, events });
}

console.log(JSON.stringify({ observations, role: 'Supplementary actual public Node API comparison; not part of frozen H01-H22 and not native Bash parity.' }));
