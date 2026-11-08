import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const isolated = path.resolve(process.argv[2] ?? '');
assert.ok(isolated.startsWith(`${directory}/isolated-`));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = JSON.parse(readFileSync(path.join(isolated, 'provenance.json')));
for (const entry of provenance.emitted) assert.equal(hash(readFileSync(path.join(isolated, 'compiled', entry.path))), entry.sha256);
const threads = createRequire(import.meta.url)('node:worker_threads');
const NativeWorker = threads.Worker;
let acquisitions = 0;
threads.Worker = class ForbiddenWorker { constructor() { acquisitions++; throw new Error('pre-aborted work acquired a worker'); } };
syncBuiltinESMExports();
const { RegexExecutor } = await import(pathToFileURL(path.join(isolated, 'compiled/src/commands/regex-execution/client.js')).href);
const { exprMatchCeilings } = await import(pathToFileURL(path.join(isolated, 'compiled/src/commands/regex-execution/protocol.js')).href);
const executor = new RegexExecutor();
const result = { started: new Date().toISOString(), workerSha256: provenance.workerSha256, driverSha256: hash(readFileSync(fileURLToPath(import.meta.url))), controls: [] };
const reason = Object.freeze({ code: 'ENOENT', marker: 'independent-abort-reason' });
try {
  const beforeOpen = new AbortController();
  beforeOpen.abort(reason);
  assert.throws(() => executor.open(beforeOpen.signal), error => error === reason);
  result.controls.push({ id: 'pre-aborted-open', passed: true, exactReasonPreserved: true });
  const beforeMatch = new AbortController();
  const session = executor.open(beforeMatch.signal);
  beforeMatch.abort(reason);
  try {
    assert.throws(() => session.matchExpr({ kind: 'expr-match', pattern: Buffer.from('\\(a*\\)*\\1'), profile: 'byte', limits: exprMatchCeilings }, Buffer.from('aaa')), error => error === reason);
    result.controls.push({ id: 'pre-aborted-match', passed: true, exactReasonPreserved: true });
  } finally { await session.close(); }
  assert.equal(acquisitions, 0);
} finally {
  await executor.dispose();
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  result.cleanup = { workerAcquisitions: acquisitions, activeOwnedWorkers: 0 };
  result.finished = new Date().toISOString();
  writeFileSync(path.join(isolated, 'cancellation-final.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result));
}
