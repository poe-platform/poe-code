export const ids = Object.freeze([
  'R01-invalid-flag', 'R02-escaping-parent-job', 'R03-profile-parent-job',
  'R04-lookalike', 'R05-cause-stack-unread', 'R06-extra-field',
  'R07-private-class-escaping', 'R08-profile-completion',
  'R09-async-publisher', 'R10-publisher-undefined',
  'R11-cleanup-undefined', 'R12-prepare-registration',
]);

function check(value, message) { if (!value) throw new Error(message); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const observation = Object.freeze({ state: 'unknown', fault: false, name: null, message: null, code: null });
const profile = () => ({ kind: 'profileFailure', observation });

export async function runRawControl(id, api, owner) {
  check(ids.includes(id), 'unknown sealed raw control');
  owner.assertActive(id);
  const trace = [];
  const writes = [];
  const caller = new AbortController();
  const sentinel = Object.freeze({ role: 'independent-raw-reason', id });
  const callbacks = [];
  const context = {
    args: ['-e', ''], cwd: '/work', env: {}, signal: caller.signal,
    fs: { async readFile() { throw new Error('unexpected FS read'); } },
    stdin: { [Symbol.asyncIterator]() { throw new Error('unexpected stdin acquisition'); } },
    stdout: { async write(bytes) { writes.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { writes.push(Uint8Array.from(bytes)); } },
    registerCleanup(callback) { trace.push('register'); callbacks.push(callback); },
  };
  let start = async () => profile();
  let retiring = async () => ({ acquisition: 'none', exitCode: null });
  const provider = {
    profile: api.NODE_PROFILE, identity: 'independent-raw-no-worker',
    prepare(request, services) {
      trace.push('prepare');
      check(trace[0] === 'register', 'cleanup must precede prepare');
      return { start: () => start(services), cancel() { trace.push('cancel'); }, retire: () => retiring() };
    },
  };
  let command;
  let rescued = false;
  const rescues = [];
  try {
    if (id === 'R04-lookalike') {
      check(api.fsDescriptor({ name: 'FsError', code: 'ENOENT', errno: -1, message: 'fake' }) === undefined, 'lookalike converted');
      return;
    }
    if (id === 'R05-cause-stack-unread' || id === 'R06-extra-field') {
      const error = new api.FsError('ENOENT', { path: '/missing' });
      let reads = 0;
      for (const name of ['stack', 'cause']) Object.defineProperty(error, name, { configurable: true, get() { reads += 1; throw sentinel; } });
      if (id === 'R06-extra-field') Object.defineProperty(error, 'unrelated', { value: 1 });
      const result = api.fsDescriptor(error);
      check(reads === 0, 'nontransported accessor read');
      check(id === 'R06-extra-field' ? result === undefined : result?.code === 'ENOENT' && result.path === '/missing', 'FS recognition result');
      return;
    }
    if (id === 'R09-async-publisher' || id === 'R10-publisher-undefined') {
      const gate = deferred();
      const registration = owner.enrollRescue(() => { rescued = true; gate.resolve(); });
      rescues.push(registration);
      let settled = false;
      const pending = api.publishNodeObservation(sentinel, async () => {
        await gate.promise;
        if (id === 'R10-publisher-undefined') throw undefined;
      }).then(value => { settled = true; return value; });
      await Promise.resolve();
      check(!settled, 'publication settled before owned completion');
      gate.resolve();
      const receipt = await pending;
      check(id === 'R10-publisher-undefined' ? receipt.publisherFault?.present === true && receipt.publisherFault.value === undefined : receipt.publisherFault === undefined, 'publisher fault presence');
      return;
    }
    if (id === 'R01-invalid-flag') context.args = ['--inspect'];
    if (id === 'R02-escaping-parent-job' || id === 'R03-profile-parent-job') {
      const entered = deferred();
      const released = deferred();
      const registration = owner.enrollRescue(() => { rescued = true; released.resolve(); });
      rescues.push(registration);
      context.fs.readFile = async (_path, options) => {
        trace.push('fs-enter'); entered.resolve();
        const onAbort = () => { trace.push('fs-abort'); released.resolve(); };
        options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.signal.aborted) onAbort();
        try { await released.promise; options.signal.throwIfAborted(); return new Uint8Array(); }
        finally { options.signal.removeEventListener('abort', onAbort); trace.push('fs-closed'); }
      };
      start = async services => {
        const pending = services.request({ sequence: 1, op: 'readText', authority: 'data', path: '/held', flag: 'r', text: null, moduleKey: null });
        void pending.catch(() => {});
        await entered.promise;
        if (id === 'R02-escaping-parent-job') throw sentinel;
        return profile();
      };
    }
    if (id === 'R07-private-class-escaping') {
      const privateClassReason = new api.NodeProfileError('external-origin');
      start = async () => { throw privateClassReason; };
      command = api.createNodeCommand({ provider });
      let thrown = false;
      try { await command.execute(context); } catch (reason) { thrown = true; check(reason === privateClassReason, 'escaping class reason identity'); }
      check(thrown, 'escaping class reason mapped to status');
      return;
    }
    if (id === 'R11-cleanup-undefined') retiring = async () => { throw undefined; };
    command = api.createNodeCommand({ provider, grants: { dataRead: true, stderrWrite: true } });
    let result;
    let rejected = false;
    let reason;
    try { result = await command.execute(context); } catch (error) { rejected = true; reason = error; }
    if (id === 'R02-escaping-parent-job') check(rejected && reason === sentinel, 'escaping raw reason');
    else if (id === 'R11-cleanup-undefined') check(rejected && reason === undefined, 'cleanup undefined hidden');
    else check(!rejected && result.exitCode === 2, 'private completion/usage status');
    if (id === 'R01-invalid-flag') {
      check(!trace.includes('prepare') && writes.length > 0, 'early diagnostic/acquisition');
      check(new TextDecoder().decode(writes[0]).startsWith('node: '), 'bounded command diagnostic');
    }
    if (id === 'R02-escaping-parent-job' || id === 'R03-profile-parent-job') {
      check(trace.includes('fs-abort') && trace.includes('fs-closed'), 'parent work not cooperatively closed');
      check(!caller.signal.aborted, 'parent caller poisoned');
    }
    if (id === 'R12-prepare-registration') check(trace[0] === 'register' && trace[1] === 'prepare', 'acquisition ordering');
  } finally {
    for (const callback of callbacks) { try { await callback(); } catch (reason) { owner.recordCleanupRejection(reason); } }
    for (const registration of rescues) registration.close();
    owner.assertRetired(id);
    check(!rescued, 'failed-subject rescue is not subject cleanup success');
  }
}
