import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeLauncher } from '../src/native-process.js';

if (process.env.REMOTE_PROCESS_NATIVE !== '1') throw new Error('Explicit host-native oracle opt-in is required');

test('separate host qualification confirms an admitted process group disappears after leader exit', { timeout: 2500 }, async () => {
  const delegate = 'process.stdout.write("ready");setInterval(()=>{},1000)';
  const code = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(delegate)}],{stdio:['ignore','pipe','inherit']});child.stdout.once('data',()=>process.exit(7));`;
  const run = createNativeLauncher().launch({
    executable: process.execPath, cwd: '/', env: {},
    args: ['-e', code].map(text => Array.from(new TextEncoder().encode(text))),
    inputChannels: [], outputChannels: [2, 3], maxFrameBytes: 4096,
  }, { async output() {}, async end() {} });
  try {
    assert.deepEqual(await run.exit, { kind: 'exited', exitCode: 7 });
    assert.ok(run.terminateGroup);
    await run.terminateGroup();
    await run.settled;
  } finally {
    await run.terminateGroup?.();
    await run.settled;
  }
});
