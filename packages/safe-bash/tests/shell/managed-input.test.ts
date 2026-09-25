import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineManagedSignals } from '../../src/fs/creation-mask.js';
import { Shell } from '../../src/shell/shell.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

test('bounded command stdin composes managed invocation cancellation', async () => {
  const shell = new Shell({fs:new MemoryFileSystem()});
  shell.register({name:'bounded-input',async execute(context) {
    assert.ok(context.stdinInput);
    const result = await context.stdinInput.read(16,combineManagedSignals(context.signal,new AbortController().signal));
    if (!result.done) await context.stdout.write(result.value);
    return {exitCode:0};
  }});
  try { const result = await shell.exec('bounded-input',{stdin:'input'});assert.equal(result.exitCode,0,result.stderr);assert.equal(result.stdout,'input'); }
  finally { await shell.dispose(); }
});
