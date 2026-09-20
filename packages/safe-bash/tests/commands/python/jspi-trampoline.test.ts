import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPythonJspiTrampoline, createPythonJspiNativeCall, createPythonJspiStatResult, pythonJspiSignatures } from '../../../src/commands/python/jspi-trampoline.js';

const WebAssembly = (globalThis as any).WebAssembly;

test('build-time trampoline has every pinned native import signature', () => {
  const module = new WebAssembly.Module(createPythonJspiTrampoline());
  const exports = WebAssembly.Module.exports(module);
  assert.deepEqual(exports.map((entry: {name:string}) => entry.name), Object.keys(pythonJspiSignatures));
  const imports = WebAssembly.Module.imports(module);
  assert.equal(imports.filter((entry: {kind:string}) => entry.kind === 'function').length, exports.length * 3);
  assert.ok(imports.some((entry: {name:string;kind:string}) => entry.name === 'syncify' && entry.kind === 'table'));
});

test('inactive trampoline calls the original native function without async dispatch', () => {
  const module = new WebAssembly.Module(createPythonJspiTrampoline());
  const original = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name, (...args: unknown[]) => args.length]));
  const request = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name, () => { throw new Error('unexpected asynchronous dispatch'); }]));
  const instance = new WebAssembly.Instance(module, {original, request, shutdown: request,
    control: {active: new WebAssembly.Global({value:'i32', mutable:true},0), syncify: new WebAssembly.Table({element:'anyfunc',initial:1})}});
  assert.equal((instance.exports.fd_read as CallableFunction)(3, 4, 5, 6), 4);
  assert.equal((instance.exports.fd_seek as CallableFunction)(3, 42n, 0, 8), 4);
});

test('shutdown trampoline enters the native JSPI boundary without a Pyodide task handback', () => {
  const module = new WebAssembly.Module(createPythonJspiTrampoline());
  const rejected = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name, () => { throw new Error('unexpected task or bootstrap dispatch'); }]));
  const calls: unknown[][] = [];
  const shutdown = Object.fromEntries(Object.keys(pythonJspiSignatures).map(name => [name, (...args: unknown[]) => { calls.push(args); return 12; }]));
  const instance = new WebAssembly.Instance(module, {original: rejected, request: rejected, shutdown,
    control: {active: new WebAssembly.Global({value:'i32', mutable:true},2), syncify: new WebAssembly.Table({element:'anyfunc',initial:1})}});
  assert.equal((instance.exports.fd_read as CallableFunction)(3, 4, 5, 6), 12);
  assert.equal((instance.exports.fd_seek as CallableFunction)(3, 42n, 0, 8), 12);
  assert.deepEqual(calls, [[3, 4, 5, 6], [3, 42n, 0, 8]]);
});

test('native Python bridge converts arguments and releases its response after constructing the Python result', () => {
  const calls: unknown[][] = [];
  const instance = new WebAssembly.Instance(new WebAssembly.Module(createPythonJspiNativeCall()), {
    python: {utf8: (argument: number) => { calls.push(['utf8', argument]); return 128; },
      unicode: (pointer: number) => { calls.push(['unicode', pointer]); return 512; },
      free: (pointer: number) => { calls.push(['free', pointer]); }, noMemory: () => 0},
    request: {send: () => { throw new Error('unexpected task dispatch'); }},
    shutdown: {send: (pointer: number) => { calls.push(['shutdown', pointer]); return 256; }},
    control: {active: new WebAssembly.Global({value:'i32',mutable:true},2), syncify: new WebAssembly.Table({element:'anyfunc',initial:1})},
  });
  assert.equal(instance.exports.call(0, 64), 512);
  assert.deepEqual(calls, [['utf8', 64], ['shutdown', 128], ['unicode', 256], ['free', 256]]);
});

test('native Python bridge preserves C API conversion failures without dispatching', () => {
  const unexpected = () => { throw new Error('unexpected native operation'); };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(createPythonJspiNativeCall()), {
    python: {utf8: () => 0, unicode: unexpected, free: unexpected, noMemory: unexpected},
    request: {send: unexpected}, shutdown: {send: unexpected},
    control: {active: new WebAssembly.Global({value:'i32',mutable:true},2), syncify: new WebAssembly.Table({element:'anyfunc',initial:1})},
  });
  assert.equal(instance.exports.call(0, 64), 0);
});

test('native stat constructor uses owned field references without importing a cleared posix module', () => {
  const references: number[] = [];
  const items: number[][] = [];
  const instance = new WebAssembly.Instance(new WebAssembly.Module(createPythonJspiStatResult()), {python:{
    fields: new WebAssembly.Global({value:'i32'}, 3), size: () => 3,
    create: (type: number) => { assert.equal(type, 42); return 64; },
    item: (tuple: number, index: number) => { assert.equal(tuple, 128); return 512 + index; },
    retain: (value: number) => { references.push(value); },
    set: (...args: number[]) => { items.push(args); }, invalid: () => { throw new Error('invalid stat'); },
  }});
  assert.equal(instance.exports.construct(42, 128), 64);
  assert.deepEqual(references, [512, 513, 514]);
  assert.deepEqual(items, [[64, 0, 512], [64, 1, 513], [64, 2, 514]]);
});

test('native stat constructor rejects a field count mismatch before allocating', () => {
  let errors = 0;
  const unexpected = () => { throw new Error('unexpected allocation'); };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(createPythonJspiStatResult()), {python:{
    fields: new WebAssembly.Global({value:'i32'}, 3), size: () => 2,
    create: unexpected, item: unexpected, retain: unexpected, set: unexpected,
    invalid: () => { errors++; return 0; },
  }});
  assert.equal(instance.exports.construct(42, 128), 0);
  assert.equal(errors, 1);
});
