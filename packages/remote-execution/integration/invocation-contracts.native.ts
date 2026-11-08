import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constants } from 'node:os';
import { setup } from '../../safe-bash/tests/shell/helpers.js';
import { createProcessSignalChannel } from '../../safe-bash/src/contracts/process.js';
import { executeRemoteProcess } from '../src/process.js';
import { createProcessConnection } from '../src/process-connection.js';

if (process.env.REMOTE_PROCESS_NATIVE !== '1') throw new Error('Explicit host-native oracle opt-in is required');

for (const handler of [true, false]) {
  test(`registered command ordered SIGINT: ${handler ? 'handler exit 42' : 'signal-only exit 130'}`, { timeout: 2000 }, async () => {
    const { shell } = setup();
    const channel = createProcessSignalChannel();
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const code = `${handler ? 'process.on("SIGINT",()=>process.exit(42));' : ''}process.stderr.write("ready");setInterval(()=>{},1000);`;
    shell.register({ name: 'native', execute(context) {
      return executeRemoteProcess(context, async () => createProcessConnection({
        executable: process.execPath, cwd: '/', env: {}, args: ['-e', code].map(text => Array.from(new TextEncoder().encode(text))),
        inputChannels: [1], outputChannels: [2, 3], maxFrameBytes: 4096,
      }), (_name, number) => 128 + number);
    } });
    const execution = shell.exec('native', { processSignals: channel, stderr: { async write() { ready(); } } });
    await started;
    assert.deepEqual(await channel.send({ name: 'SIGINT', number: constants.signals.SIGINT, target: 'process-group' }), { sequence: 1n });
    const result = await execution;
    assert.equal(result.exitCode, handler ? 42 : 130, result.stderr);
    await shell.dispose();
  });
}

test('registered native byte streams carry two inherited inputs and append progress on fd 3', { timeout: 2000 }, async () => {
  const { shell, fs } = setup();
  await fs.writeFile('/progress', new TextEncoder().encode('before:'));
  const code = 'const fs=require("node:fs");const read=fd=>new Promise((resolve,reject)=>{let value="";const s=fs.createReadStream(null,{fd,autoClose:false});s.on("data",b=>value+=b);s.on("end",()=>resolve(value));s.on("error",reject)});Promise.all([read(4),read(5)]).then(([a,b])=>fs.writeSync(3,"progress="+a+b));';
  shell.register({ name: 'native', execute(context) {
    return executeRemoteProcess(context, async () => createProcessConnection({
      executable: process.execPath, cwd: '/', env: {}, args: ['-e', code].map(text => Array.from(new TextEncoder().encode(text))),
      inputChannels: [1, 5, 6], outputChannels: [2, 3, 4], maxFrameBytes: 4096,
    }));
  } });
  const result = await shell.exec('native 4<<<alpha 5<<<beta 3>>/progress');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(new TextDecoder().decode(await fs.readFile('/progress')), 'before:progress=alpha\nbeta\n');
  await shell.dispose();
});
