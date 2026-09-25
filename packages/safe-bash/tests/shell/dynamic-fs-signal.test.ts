import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem, Shell } from '../../src/core.js';
import { createLlmCommands } from '../../src/commands/llm/index.js';

test('memory filesystem redirection combines dynamic and command signals for binary output', async () => {
  const fs = new MemoryFileSystem();
  const errors: unknown[] = [];
  const shell = new Shell({fs, onInternalError(error) {errors.push(error);}});
  const bytes = Uint8Array.of(0,255,137,80);
  shell.register(createLlmCommands({defaultModel:'image', providers:[{name:'fake',models:[{id:'image',outputType:'image/png'}], async *complete() {yield bytes;}}]})[0]!);

  try {
    const result = await shell.exec('llm hello > /image.bin');
    assert.deepEqual(errors, []);
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.deepEqual(await fs.readFile('/image.bin'), bytes);
  } finally {await shell.dispose();}
});
