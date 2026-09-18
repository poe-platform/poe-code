import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPythonJspiTrampoline, pythonJspiSignatures } from '../../../src/commands/python/jspi-trampoline.js';

const WebAssembly = (globalThis as any).WebAssembly;

test('build-time trampoline has every pinned native import signature', () => {
  const module = new WebAssembly.Module(createPythonJspiTrampoline());
  const exports = WebAssembly.Module.exports(module);
  assert.deepEqual(exports.map((entry: {name:string}) => entry.name), Object.keys(pythonJspiSignatures));
  const imports = WebAssembly.Module.imports(module);
  assert.equal(imports.filter((entry: {kind:string}) => entry.kind === 'function').length, exports.length * 2);
  assert.ok(imports.some((entry: {name:string;kind:string}) => entry.name === 'syncify' && entry.kind === 'table'));
});

test('inactive trampoline calls the original native function without async dispatch', () => {
  const module = new WebAssembly.Module(createPythonJspiTrampoline());
  const original = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name, (...args: unknown[]) => args.length]));
  const request = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name, () => { throw new Error('unexpected asynchronous dispatch'); }]));
  const instance = new WebAssembly.Instance(module, {original, request,
    control: {active: new WebAssembly.Global({value:'i32', mutable:true},0), syncify: new WebAssembly.Table({element:'anyfunc',initial:1})}});
  assert.equal((instance.exports.fd_read as CallableFunction)(3, 4, 5, 6), 4);
  assert.equal((instance.exports.fd_seek as CallableFunction)(3, 42n, 0, 8), 4);
});
