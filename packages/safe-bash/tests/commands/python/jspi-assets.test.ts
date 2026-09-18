import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPythonJspiAssets } from '../../../src/commands/python/jspi-assets.js';

const engine = (globalThis as any).WebAssembly;
const empty = new Uint8Array([0,97,115,109,1,0,0,0]);

test('static asset adapter matches complete bytes, never just length or guest URLs', async () => {
  const module = new engine.Module(empty);
  const assets = createPythonJspiAssets({main:module, stdlib:new Uint8Array([0,255,42]), modules:[{bytes:empty,module}]});
  assert.equal(new assets.WebAssembly.Module(empty),module);
  assert.equal(await assets.WebAssembly.compile(empty.slice()),module);
  const changed = empty.slice(); changed[7] = 1;
  assert.throws(() => new assets.WebAssembly.Module(changed), /Unapproved/);
  await assert.rejects(assets.WebAssembly.compile(changed), /Unapproved/);
  await assert.rejects(assets.fetch('https://other.invalid/python_stdlib.zip'), /Unapproved/);
  const response = await assets.fetch(assets.location + 'python_stdlib.zip');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([0,255,42]));
  const main = await assets.fetch(assets.location + 'pyodide.asm.wasm');
  assert.equal((await assets.WebAssembly.instantiateStreaming(main,{})).module,module);
  await assert.rejects(assets.WebAssembly.instantiateStreaming(new Response(empty),{}), /Unapproved/);
});

test('asset registry owns its admitted bytes and does not patch globals', async () => {
  const module = new engine.Module(empty);
  const bytes = empty.slice();
  const stdlib = new Uint8Array([42]);
  const options = {main:module,stdlib,modules:[{bytes,module}]};
  const assets = createPythonJspiAssets(options);
  options.main = new engine.Module(empty);
  bytes[0] = 255;
  stdlib[0] = 255;
  assert.equal((globalThis as any).WebAssembly,engine);
  assert.equal(new assets.WebAssembly.Module(empty),module);
  assert.equal(new Uint8Array(await (await assets.fetch(assets.location+'python_stdlib.zip')).arrayBuffer())[0],42);
  const response = await assets.fetch(assets.location+'pyodide.asm.wasm');
  assert.equal((await assets.WebAssembly.instantiateStreaming(response,{})).module,module);
});
