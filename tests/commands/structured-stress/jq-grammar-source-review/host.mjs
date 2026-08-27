import assert from 'node:assert/strict';
import { artifact, snapshot } from './common.mjs';

const before = snapshot();
const { createStructuredCommands, MemoryFileSystem, FsError, writeBytes } = await import('../../../../src/index.ts');
const { JqError } = await import('../../../../src/commands/structured/limits.ts');
const rows = [];
for (const failure of [new Error('host stdout generic'), new FsError('EPIPE'), new FsError('EIO'), new JqError('host sink failure')]) {
  let helperIdentity = false;
  try { await writeBytes({ async write() { throw failure; } }, Buffer.from('x')); }
  catch (error) { helperIdentity = error === failure; }
  assert.equal(helperIdentity, true);
  for (const input of ['1\n2\n', 'NaN\nInfinity\n']) {
    let reads = 0;
    let writes = 0;
    let closed = 0;
    const stderr = [];
    const attempted = [];
    const fs = new MemoryFileSystem();
    const stdin = (async function* () {
      try { for (const record of input.trimEnd().split('\n')) { reads++; yield Buffer.from(`${record}\n`); } }
      finally { closed++; }
    })();
    const command = createStructuredCommands().find(definition => definition.name === 'jq');
    let outcome;
    try {
      const result = await command.execute({ command: 'jq', args: ['-c', '.'], fs, cwd: '/', env: {}, stdin, stdinIsDefault: false,
        stdout: { async write(bytes) { writes++; attempted.push(Buffer.from(bytes).toString('hex')); throw failure; } },
        stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } }, signal: AbortSignal.timeout(1000) });
      outcome = { kind: 'resolved', exitCode: result.exitCode };
    } catch (error) { outcome = { kind: 'rejected', identity: error === failure, constructor: error.constructor.name, message: error.message, code: error.code }; }
    const row = { failureClass: failure.constructor.name, helperIdentity, inputHex: Buffer.from(input).toString('hex'), argv: ['-c', '.'], outcome,
      reads, writes, closed, attemptedStdoutHex: attempted, committedStdoutHex: '', stderrHex: Buffer.concat(stderr).toString('hex'), namespace: await fs.readdir('/') };
    rows.push(row);
    assert.equal(outcome.kind, 'rejected');
    assert.equal(outcome.identity, true);
    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.equal(closed, 1);
    assert.equal(row.stderrHex, '');
  }
}
artifact('host-contract.json', { before, after: snapshot(), rows,
  classification: 'Host contract observation, never native parity. The old failing branch instantiates JqError, not generic Error. Parent jq.ts rethrew generic Error and EPIPE; it converted JqError to status 5 and EIO to status 2. Handoff now rethrows all stdout-origin failures. Shared writeBytes preserves rejection identity; CommandHandler does not specify typed sink-error status conversion. Typed conversion is nevertheless observable old behavior with an explicit JqError assertion; root must adjudicate before changing it.' });
console.log('host boundaries', rows.length, 'identity/closure/byte effects preserved');
