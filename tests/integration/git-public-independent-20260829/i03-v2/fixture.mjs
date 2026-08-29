import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as api from 'virtual-bash';
const record = { id: 'I03-v2', layout: process.env.I03_LAYOUT, pass: false, primaryPresent: false, cleanupPresent: false, setupCalls: 0, commands: [], unhandled: [] };
const unhandled = reason => record.unhandled.push(String(reason));
process.on('unhandledRejection', unhandled);
let owner;
let setupReason;
let setupReasonPresent = false;
try {
  const neutral = JSON.parse(await fs.readFile(new URL('./fixture.json', import.meta.url), 'utf8'));
  const memory = new api.MemoryFileSystem();
  for (const row of neutral.files) {
    const filename = '/repo/' + row.path;
    await memory.mkdir(path.posix.dirname(filename), { recursive: true });
    await memory.writeFile(filename, row.text === undefined ? Buffer.from(row.base64, 'base64') : Buffer.from(row.text));
    await memory.chmod(filename, row.mode);
  }
  owner = new api.Shell({ fs: memory, cwd: '/repo' }).use(api.gitCommands());
  owner.use(async (context, next) => { record.commands.push([context.command, ...context.args]); return next(); });
  const initial = await owner.exec('git show HEAD:src/app.txt');
  record.initial = { exitCode: initial.exitCode, stdoutHex: Buffer.from(initial.stdoutBytes).toString('hex'), stderrHex: Buffer.from(initial.stderrBytes).toString('hex') };
  assert.equal(initial.exitCode, 0);
  assert.equal(initial.stdout, 'two\n');
  assert.equal(initial.stderr, '');
  assert.deepEqual(record.commands, [['git', 'show', 'HEAD:src/app.txt']]);
  const beforeIndex = Buffer.from(await memory.readFile('/repo/.git/index'));
  const beforeFile = Buffer.from(await memory.readFile('/repo/src/app.txt'));
  const duplicate = api.gitCommands();
  const observed = { ...duplicate, setup(host) {
    record.setupCalls++;
    try { return duplicate.setup.call(duplicate, host); }
    catch (reason) { setupReasonPresent = true; setupReason = reason; throw reason; }
  } };
  const returned = owner.use(observed);
  record.useReturnedOwner = returned === owner;
  record.setupCallsAtUseReturn = record.setupCalls;
  assert.equal(returned, owner);
  assert.equal(record.setupCalls, 0);
  let rejected = false;
  let publicReason;
  try { await owner.exec('git show HEAD:src/app.txt'); }
  catch (reason) { rejected = true; publicReason = reason; }
  record.rejected = rejected;
  record.setupReasonPresent = setupReasonPresent;
  record.reasonIdentityPreserved = rejected && setupReasonPresent && publicReason === setupReason;
  record.errorName = publicReason?.name;
  record.errorMessage = publicReason?.message;
  assert.equal(rejected, true);
  assert.equal(setupReasonPresent, true);
  assert.equal(record.setupCalls, 1);
  assert.equal(publicReason, setupReason);
  assert.equal(publicReason.name, 'Error');
  assert.equal(publicReason.message, 'Command already registered: git');
  assert.deepEqual(record.commands, [['git', 'show', 'HEAD:src/app.txt']]);
  assert.deepEqual(Buffer.from(await memory.readFile('/repo/.git/index')), beforeIndex);
  assert.deepEqual(Buffer.from(await memory.readFile('/repo/src/app.txt')), beforeFile);
  record.markerBytesUnchanged = true;
  record.pass = true;
} catch (reason) {
  record.primaryPresent = true;
  record.primary = String(reason?.stack ?? reason);
} finally {
  try { if (owner) { await owner.dispose(); record.disposalFulfilled = true; } }
  catch (reason) { record.cleanupPresent = true; record.cleanup = String(reason?.stack ?? reason); }
  await new Promise(resolve => setImmediate(resolve));
  process.removeListener('unhandledRejection', unhandled);
}
record.pass = record.pass && !record.primaryPresent && !record.cleanupPresent && record.disposalFulfilled === true && record.unhandled.length === 0;
console.log(JSON.stringify(record));
process.exitCode = record.pass ? 0 : 1;
