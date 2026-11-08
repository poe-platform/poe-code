import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const encode = value => new TextEncoder().encode(value);
const settle = promise => Promise.resolve(promise).then(value => ({ state: 'fulfilled', value }), reason => ({ state: 'rejected', category: reason?.category, code: reason?.code, message: reason?.message }));
export async function run(payload) {
  const base = pathToFileURL(`${realpathSync(payload.installed)}/`).href;
  const protocol = await import(`${base}dist/commands/regex-execution/protocol.js`);
  const { RegexExecutor, RegexSession } = await import(`${base}dist/commands/regex-execution/client.js`);
  const descriptor = (pattern = 'a', profile = 'byte', limits = {}) => ({ kind: 'expr-match', pattern: encode(pattern), profile, limits: { ...protocol.exprMatchCeilings, maxSteps: 1000000, ...limits } });
  if (payload.mode === 'malformed-request') {
    let request = { id: 7, descriptor: descriptor(), rows: [{ bytes: encode('a'), all: false, terminated: false }] };
    switch (payload.variant) {
      case 'null': request = null; break;
      case 'id-string': request.id = '7'; break;
      case 'missing-subject': delete request.rows[0].bytes; break;
      case 'pattern-string': request.descriptor.pattern = 'a'; break;
      case 'limit-negative': request.descriptor.limits.maxSteps = -1; break;
      case 'limit-fractional': request.descriptor.limits.maxSteps = 1.5; break;
      case 'limit-unsafe': request.descriptor.limits.maxSteps = Number.MAX_SAFE_INTEGER + 1; break;
      case 'wrong-kind': request.descriptor.kind = 'unknown'; break;
      default: throw new Error('unknown malformed request variant');
    }
    async function exchange(request) {
      const worker = new Worker(new URL(`${base}dist/commands/regex-execution/worker.js`), { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64 } });
      let sent = false;
      const outcome = await new Promise(resolve => {
        const timer = setTimeout(() => resolve({ state: 'timeout' }), 600);
        const finish = value => { clearTimeout(timer); resolve(value); };
        worker.on('message', value => {
          if (!sent && value?.ready) { sent = true; worker.postMessage(request); }
          else finish({ state: 'reply', value });
        });
        worker.on('error', error => finish({ state: 'worker-error', name: error.name, message: error.message }));
        worker.on('exit', code => finish({ state: 'worker-exit', code }));
      });
      await worker.terminate();
      return { ...outcome, terminationAwaited: true, entry: `${base}dist/commands/regex-execution/worker.js` };
    }
    const invalid = await exchange(request);
    const valid = await exchange({ id: 8, descriptor: descriptor(), rows: [{ bytes: encode('a'), all: false, terminated: false }] });
    return { invalid, valid, passed: invalid.state !== 'timeout' && !(invalid.state === 'reply' && invalid.value.result) && valid.state === 'reply' && valid.value.result?.matched === true, classification: 'Malformed requests may retire/crash only their worker; no fabricated success and fresh positive must succeed.' };
  }
  if (payload.mode === 'shared-work') {
    const { createExprCommand } = await import(`${base}dist/commands/expr/index.js`);
    const allowances = [], results = [], original = RegexSession.prototype.matchExpr;
    RegexSession.prototype.matchExpr = async function (descriptor, subject) {
      allowances.push(descriptor.limits.maxSteps);
      const result = await original.call(this, descriptor, subject); results.push(result.steps); return result;
    };
    const stdout = [], stderr = [];
    try {
      const result = await createExprCommand({ limits: { maxSteps: 10000 } }).execute({ command: 'expr', args: ['(', 'a', ':', 'a', ')', '+', '(', 'a', ':', 'a', ')'], cwd: '/', env: { LC_ALL: 'C' }, signal: new AbortController().signal, get stdin() { throw new Error('stdin accessed'); }, fs: {}, stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } }, stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } } });
      return { result, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64'), allowances, chargedWorkerSteps: results, passed: result.exitCode === 0 && allowances.length === 2 && allowances[1] < allowances[0] - results[0] };
    } finally { RegexSession.prototype.matchExpr = original; }
  }
  const executor = new RegexExecutor(); const session = executor.open(new AbortController().signal);
  try {
    if (payload.mode === 'cache') {
      const first = await session.matchExpr(descriptor('.', 'byte'), encode('é'));
      const firstCopy = structuredClone(first); first.overall.end = 999;
      const second = await session.matchExpr(descriptor('.', 'utf8-scalar'), encode('é'));
      const third = await session.matchExpr(descriptor('b'), encode('a'));
      const fourth = await session.matchExpr(descriptor('.', 'byte'), encode('é'));
      return { firstCopy, second, third, fourth, passed: firstCopy.overall.end === 1 && second.overall.end === 2 && !third.matched && fourth.overall.end === 1 };
    }
    if (payload.mode === 'worker-limits') {
      const good = await settle(Promise.resolve().then(() => session.matchExpr(descriptor(payload.pattern), encode(payload.subject))));
      const restrictive = await settle(Promise.resolve().then(() => session.matchExpr(descriptor(payload.pattern, 'byte', payload.limits), encode(payload.subject))));
      return { good, restrictive, passed: good.state === 'fulfilled' && restrictive.state === 'rejected' && restrictive.category === 'limit' };
    }
    if (payload.mode === 'legacy-protocol') {
      const rows = [{ bytes: encode('éa'), all: true, terminated: true }];
      const grep = await session.run({ kind: 'grep', patterns: ['.'], fixed: false, extended: true, insensitive: false, whole: false, word: false }, rows);
      const rg = await session.run({ kind: 'rg', patterns: ['.'], fixed: false, case: 'sensitive', whole: false, word: false, nullData: false }, rows);
      const glob = await session.run({ kind: 'glob', patterns: ['*.ts'], globOptions: [{ insensitive: false, literalUnclosedClass: false }] }, [{ bytes: Buffer.from('a.ts', 'utf16le'), all: false, terminated: true, directory: false, ancestors: false }]);
      return { grep, rg, glob, defaults: protocol.defaults, legacyValid: protocol.validateReply({ id: 7, results: [new Float64Array([1, 2])] }, 7, rows, new AbortController().signal) };
    }
    throw new Error('unknown extra mode');
  } finally { await session.close(); await executor.dispose(); }
}
