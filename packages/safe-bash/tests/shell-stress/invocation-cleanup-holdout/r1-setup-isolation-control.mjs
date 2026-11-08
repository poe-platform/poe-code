import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { Shell, MemoryFileSystem } = await import(pathToFileURL(process.argv[2]).href);
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const events = [];
const liveLeases = new Set();
const hosts = {};
const activeEntered = gate();
const activeRelease = gate();
const nestedEntered = gate();
const nestedRelease = gate();
const shell = new Shell({ fs: new MemoryFileSystem() });
let factoryCalls = 0;
let disposed = false;
const factory = () => { factoryCalls++; return new MemoryFileSystem(); };
const middleware = (_context, next) => next();
const acquire = (name, host) => { hosts[name] = host; liveLeases.add(name); events.push(name + '-setup'); };
const release = name => { events.push(name + '-dispose'); liveLeases.delete(name); };
const closedHost = (name, scheme) => {
  assert.throws(() => hosts[name].use(middleware), Error);
  assert.throws(() => hosts[name].registerFileSystem(scheme, factory), Error);
  events.push(name + '-host-closed');
};
const publicClosed = async label => {
  assert.throws(() => shell.use(middleware), Error);
  assert.throws(() => shell.registerFileSystem(label, factory), Error);
  assert.throws(() => shell.register({ name: label, execute: () => ({ exitCode: 0 }) }), Error);
  await assert.rejects(shell.exec(':'), Error);
  events.push(label + '-public-closed');
};

const keepAlive = setInterval(() => {}, 1000);
let failure;
try {
  shell.use({ name: 'completed', setup(host) { acquire('completed', host); }, dispose() { release('completed'); } });
  const initial = await shell.exec(':');
  assert.equal(initial.exitCode, 0);
  assert.equal(initial.stdoutBytes.length, 0);
  assert.equal(initial.stderrBytes.length, 0);
  shell.use({ name: 'active', async setup(host) {
    acquire('active', host);
    activeEntered.release();
    await activeRelease.promise;
    host.use(middleware);
    host.registerFileSystem('activefs', factory);
    host.use({ name: 'nested', async setup(nestedHost) {
      acquire('nested', nestedHost);
      nestedEntered.release();
      await nestedRelease.promise;
      nestedHost.use(middleware);
      nestedHost.registerFileSystem('nestedfs', factory);
      events.push('nested-installed');
    }, dispose() { release('nested'); } });
    events.push('active-installed-and-nested-enqueued');
  }, dispose() { release('active'); } });
  shell.use({ name: 'queued', setup(host) {
    acquire('queued', host);
    host.use(middleware);
    host.registerFileSystem('queuedfs', factory);
  }, dispose() { release('queued'); } });
  await activeEntered.promise;
  const disposal = shell.dispose();
  void disposal.then(() => { disposed = true; }, () => { disposed = true; });
  assert.equal(shell.dispose(), disposal);
  await publicClosed('duringactive');
  closedHost('completed', 'completedlate');
  await turn();
  assert.equal(disposed, false);
  activeRelease.release();
  await nestedEntered.promise;
  assert.notEqual(hosts.active, hosts.nested);
  assert.notEqual(hosts.completed, hosts.active);
  closedHost('active', 'activelate');
  closedHost('queued', 'queuedlate');
  await publicClosed('duringnested');
  await turn();
  assert.equal(disposed, false, 'disposal must join the extended readiness chain');
  nestedRelease.release();
  await disposal;
  assert.equal(disposed, true);
  assert.equal(liveLeases.size, 0);
  assert.equal(factoryCalls, 0);
  assert.deepEqual(events.filter(event => event.endsWith('-dispose')), ['nested-dispose', 'queued-dispose', 'active-dispose', 'completed-dispose']);
  closedHost('nested', 'nestedlate');
  await publicClosed('afterdispose');
  await shell.dispose();
} catch (error) {
  failure = { name: error?.name, message: error?.message, stack: error?.stack };
} finally {
  clearInterval(keepAlive);
}
console.log(JSON.stringify({ id: 'S1-async-per-setup-isolation-and-nesting', pass: failure === undefined, failure, events, liveLeases: [...liveLeases], factoryCalls, disposed, scope: 'One supplementary post-replay control. Nested plugin host.use is existing JavaScript runtime behavior, not a new PluginHost TypeScript signature claim.' }));
if (failure !== undefined) process.exitCode = 1;
