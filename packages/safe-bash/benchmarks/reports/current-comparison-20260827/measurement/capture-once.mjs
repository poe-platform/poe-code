import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const owned = fileURLToPath(new URL('.', import.meta.url));
const freeze = `${owned}../measurement-freeze/`;
const scratch = '/private/tmp/safe-bash-measurement-freeze-XAFOrN';
const output = `${scratch}/measurement-attempt-001`;
const pins = {
  [`${freeze}execution-binding.json`]: '1c74655402eba80a12e1c190fa43ba6923faace8a7db81c7f17da8a3b4528b1e',
  [`${freeze}proposed-root-receipt.json`]: 'c0f9468f33d1df5ec468bc98830c06fc8fcadb797f3595b0a7fa18f346f607a5',
  [`${scratch}/tools/node`]: '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = () => Object.fromEntries(Object.entries(pins).map(([filename, expected]) => {
  const bytes = readFileSync(filename);
  const actual = sha256(bytes);
  assert.equal(actual, expected, `changed input: ${filename}`);
  return [filename, { bytes: bytes.length, sha256: actual }];
}));
const commandFile = readFileSync(`${freeze}NEXT_COMMAND.txt`);
const command = commandFile.toString('utf8').split('\n')[1];
assert.ok(command.startsWith('/usr/bin/env -i '));
assert.ok(command.includes(`'--output' '${output}'`));
assert.equal(existsSync(output), false, 'bridge destination must not exist');
const before = verify();
const receipt = JSON.parse(readFileSync(`${freeze}proposed-root-receipt.json`, 'utf8'));
assert.equal(receipt.candidateCommit, 'e33974b8c643077453227a9679d8ceca8367998c');
assert.equal(receipt.exactSourceSha256, '903784b4a5b1123d285e81fff65883b44d486759fb5ce3f4d28c602ed66736cf');
assert.equal(receipt.exactPackageSha256, 'bc4f0e01d9daba5dc7c99a7d66615e52808a83a162140d59e88544c7c71fbd51');
const publish = (filename, value) => writeFile(`${owned}${filename}`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const capBytes = 16 * 1024 * 1024;
const stdoutFile = await open(`${owned}driver.stdout`, 'wx', 0o600);
const stderrFile = await open(`${owned}driver.stderr`, 'wx', 0o600);
await publish('launch-intent.json', {
  command, commandFileSha256: sha256(commandFile), commandSha256: sha256(command),
  output, before, capBytesPerChannel: capBytes, destinationAbsent: true,
  scope: 'COMMITTED_FROZEN_COMPARISON_ONLY', adoptedRootReceipt: true,
  authorization: 'Explicit ROOT execution authorization and pre-import announcement supplied by user',
  requestedAt: new Date().toISOString(), wrapperPid: process.pid,
  outputPolicy: 'Separate bounded streaming prefixes; all received bytes hashed; overflow retained as capture failure, not a score or reason to kill productive children',
  restartPolicy: 'No retries; launch-intent and exclusive output files prevent rerunning this launcher',
});
const child = spawn('/bin/sh', ['-c', command], {
  cwd: '/Users/kjopek/Workspace/safe-bash', detached: true,
  env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let exit = null;
let spawnError = null;
child.on('exit', (code, signal) => { exit = { code, signal }; });
child.on('error', error => { spawnError = { code: error.code, message: error.message }; });
const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
const capture = async (stream, file) => {
  const digest = createHash('sha256');
  let receivedBytes = 0;
  let storedBytes = 0;
  let error = null;
  try {
    for await (const chunk of stream) {
      receivedBytes += chunk.length;
      digest.update(chunk);
      const bytes = chunk.subarray(0, Math.max(0, capBytes - storedBytes));
      let written = 0;
      while (written < bytes.length) {
        const result = await file.write(bytes, written, bytes.length - written);
        assert.ok(result.bytesWritten > 0);
        written += result.bytesWritten;
      }
      storedBytes += written;
    }
  } catch (failure) { error = { code: failure.code, message: failure.message }; }
  await file.close();
  return { receivedBytes, storedBytes, receivedSha256: digest.digest('hex'), overflow: receivedBytes > capBytes, error };
};
const captures = Promise.all([capture(child.stdout, stdoutFile), capture(child.stderr, stderrFile)]);
await publish('run-receipt.json', {
  startedAt: new Date().toISOString(), wrapperPid: process.pid,
  commandProcessPid: child.pid, commandProcessGroup: child.pid,
  exactCommand: command, commandSha256: sha256(command), output,
  bindingSha256: pins[`${freeze}execution-binding.json`],
  rootReceiptSha256: pins[`${freeze}proposed-root-receipt.json`],
  candidate: receipt.candidateCommit, sourceSha256: receipt.exactSourceSha256,
  candidatePackSha256: receipt.exactPackageSha256,
  planned: { original: 448, aligned: 448, breadth: 136 }, score: null,
});
console.log(JSON.stringify({ event: 'driver-launched-once', commandProcessPid: child.pid, output }));
const close = await closed;
const [stdout, stderr] = await captures;
let after = null;
let postHashError = null;
try { after = verify(); } catch (error) { postHashError = String(error); }
let commandProcessGroupGone = null;
try { process.kill(-child.pid, 0); commandProcessGroupGone = false; }
catch (error) { if (error.code === 'ESRCH') commandProcessGroupGone = true; }
const completion = { closedAt: new Date().toISOString(), exit, close, spawnError, stdout, stderr, after, postHashError, commandProcessGroupGone, wrapperSignalsSent: [], reviewRequired: true, score: null };
await publish('driver-completion.json', completion);
console.log(JSON.stringify({ event: 'driver-closed', ...completion }));
process.exitCode = close.code === 0 && !close.signal && !spawnError && !postHashError && !stdout.error && !stderr.error && !stdout.overflow && !stderr.overflow ? 0 : 1;
