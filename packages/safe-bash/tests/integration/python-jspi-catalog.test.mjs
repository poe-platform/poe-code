import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { createPythonJspiAssets } from '../../src/commands/python/jspi-assets.ts';
import { createPythonJspiCallbackCatalog, createPythonJspiCallbackModule,
  extractPythonJspiCallbackSignatures } from './python-jspi-catalog.mjs';
import { observePythonJspiUnhandledErrors } from './python-jspi-errors.mjs';

const vi = Uint8Array.from([0,97,115,109,1,0,0,0,1,135,0,1,96,129,0,127,128,0,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0]);
const empty = Uint8Array.from([0,97,115,109,1,0,0,0]);

test('Worker event gate retains unhandled rejection/error evidence without engine patches or suppression', () => {
  const scope = new EventTarget();
  const gate = observePythonJspiUnhandledErrors(scope);
  const rejection = new Event('unhandledrejection', {cancelable:true});
  rejection.reason = new WebAssembly.CompileError('missing vi');
  const error = new Event('error');
  error.error = new Error('startup error');
  scope.dispatchEvent(rejection);
  scope.dispatchEvent(error);
  assert.equal(rejection.defaultPrevented, false);
  const expected = [{type:'unhandledrejection', reason:'CompileError: missing vi'}, {type:'error', reason:'Error: startup error'}];
  const snapshot = gate.snapshot();
  assert.deepEqual(snapshot, expected);
  snapshot[0].reason = 'tampered';
  snapshot.length = 0;
  assert.deepEqual(gate.snapshot(), expected);
  gate.dispose();
  scope.dispatchEvent(error);
  assert.deepEqual(gate.snapshot(), expected);
});

test('the reported vi adapter is rejected by the old helper-only registry', () => {
  const module = new WebAssembly.Module(empty);
  const assets = createPythonJspiAssets({ main: module, stdlib: empty, modules: [{ module, bytes: empty }] });
  assert.throws(() => new assets.WebAssembly.Module(vi), WebAssembly.CompileError);
});

test('vi and vii reproduce the pinned padded ULEB encoding, not canonical encoding', () => {
  assert.deepEqual(createPythonJspiCallbackModule('vi'), vi);
  const vii = createPythonJspiCallbackModule('vii');
  assert.deepEqual(Array.from(vii), [0,97,115,109,1,0,0,0,1,136,0,1,96,130,0,127,127,128,0,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0]);
  const seen = [];
  const instance = new WebAssembly.Instance(new WebAssembly.Module(vii), { e: { f: (...args) => seen.push(args) } });
  instance.exports.f(42, 43);
  assert.deepEqual(seen, [[42, 43]]);
});

test('AST extraction collects all annotations, normalizes pointers and deduplicates without executing glue', () => {
  const ast = ts.createSourceFile('fixture.mjs', `
    throw new Error('do not execute');
    first.sig = 'vp'; second.sig = 'vi'; third['sig'] = 'vii';
    fourth.sig = 'ipjfde'; fifth.sig = 'p'; sixth.sig = 'v';
    const text = "ignored.sig = 'viiii'";
    // comment.sig = 'viiii';
    nested(() => { seventh.sig = 'dppp'; });
  `, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.deepEqual(extractPythonJspiCallbackSignatures(ast), ['diii', 'i', 'iijfde', 'v', 'vi', 'vii']);
});

test('nonliteral annotations and unsupported types fail closed', () => {
  for (const source of ['callback.sig = variable', "callback.sig = 'vx'", "callback.sig = 'iv'", "callback.sig = ''", 'callback.sig =']) {
    const ast = ts.createSourceFile('fixture.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.throws(() => extractPythonJspiCallbackSignatures(ast));
  }
  for (const signature of ['', 'x', 'iv', 'vi'.repeat(10000)]) assert.throws(() => createPythonJspiCallbackModule(signature));
});

test('every supported Wasm type and wasm32 pointer is encoded and re-exported', () => {
  for (const [signature, value] of [['i', 42], ['p', 42], ['j', 42n], ['f', 1.5], ['d', 1.5], ['e', { answer: 42 }]]) {
    const bytes = createPythonJspiCallbackModule(signature + signature);
    const module = new WebAssembly.Module(bytes);
    assert.deepEqual(WebAssembly.Module.imports(module), [{ module: 'e', name: 'f', kind: 'function' }]);
    assert.deepEqual(WebAssembly.Module.exports(module), [{ name: 'f', kind: 'function' }]);
    const instance = new WebAssembly.Instance(module, { e: { f: argument => argument } });
    assert.equal(instance.exports.f(value), value);
  }
  assert.deepEqual(createPythonJspiCallbackModule('vp'), vi);
});

test('padded ULEB handles the parameter and section-length 128 boundaries', () => {
  for (const count of [121, 122, 127, 128]) {
    const bytes = createPythonJspiCallbackModule('v' + 'i'.repeat(count));
    assert.equal(bytes[9], (count + 6) % 128 | 128);
    assert.equal(bytes[10], (count + 6) >> 7);
    assert.equal(bytes[13], count % 128 | 128);
    assert.equal(bytes[14], count >> 7);
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { e:{f:(...args) => assert.equal(args.length, count)} });
    instance.exports.f(...Array(count).fill(42));
  }
});

test('static catalog admission checks every byte, including padded ULEB', () => {
  const module = new WebAssembly.Module(vi);
  const assets = createPythonJspiAssets({ main: module, stdlib: empty, modules: [{ module, bytes: vi }] });
  assert.equal(new assets.WebAssembly.Module(createPythonJspiCallbackModule('vp')), module);
  for (let index = 0; index < vi.length; index++) {
    const changed = vi.slice();
    changed[index] ^= 1;
    assert.throws(() => new assets.WebAssembly.Module(changed), WebAssembly.CompileError);
  }
  assert.throws(() => new assets.WebAssembly.Module(createPythonJspiCallbackModule('vii')), WebAssembly.CompileError);
  const canonical = Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,1,127,0,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0]);
  assert.throws(() => new assets.WebAssembly.Module(canonical), WebAssembly.CompileError);
});

test('glue authentication rejects size or digest drift before extraction', () => {
  assert.throws(() => createPythonJspiCallbackCatalog(Buffer.from("callback.sig = 'vi'")), /size/);
  assert.throws(() => createPythonJspiCallbackCatalog(Buffer.alloc(1250344)), /SHA-256/);
});

test('authenticated pinned glue produces the complete 96-module catalog', {
  skip: !process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT && 'Pinned external Pyodide inputs not supplied',
}, () => {
  const glue = readFileSync(resolve(process.env.SAFE_BASH_PYTHON_RUNTIME_ROOT, 'pyodide.asm.mjs'));
  const catalog = createPythonJspiCallbackCatalog(glue);
  assert.equal(catalog.length, 96);
  const ast = ts.createSourceFile('pinned.mjs', glue.toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const rawSignatures = new Set();
  let annotations = 0;
  function visit(node) {
    if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'sig') {
      assert.equal(node.operatorToken.kind, ts.SyntaxKind.EqualsToken);
      assert.ok(ts.isStringLiteral(node.right));
      annotations++;
      rawSignatures.add(node.right.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(annotations, 1295);
  assert.equal(rawSignatures.size, 184);
  const bySignature = new Map(catalog.map(entry => [entry.signature, entry.bytes]));
  for (const signature of rawSignatures) {
    const normalized = Array.from(signature, type => type === 'p' ? 'i' : type).join('');
    assert.deepEqual(createPythonJspiCallbackModule(signature), bySignature.get(normalized), signature);
  }
  assert.deepEqual(catalog.find(entry => entry.signature === 'vi').bytes, vi);
  assert.ok(catalog.some(entry => entry.signature === 'vii'));
  for (const { signature, bytes } of catalog) {
    const module = new WebAssembly.Module(bytes);
    assert.deepEqual(WebAssembly.Module.imports(module), [{ module: 'e', name: 'f', kind: 'function' }], signature);
    assert.deepEqual(WebAssembly.Module.exports(module), [{ name: 'f', kind: 'function' }], signature);
  }
  const changed = Buffer.from(glue);
  changed[0] ^= 1;
  assert.throws(() => createPythonJspiCallbackCatalog(changed), /SHA-256/);
});
