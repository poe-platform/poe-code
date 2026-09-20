import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const wasmTypeCodes = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 };

function normalizeSignature(signature) {
  assert.ok(typeof signature === 'string' && signature.length > 0 && signature.length < 16376, 'Invalid callback signature size');
  return Array.from(signature, (type, index) => {
    assert.ok(Object.hasOwn(wasmTypeCodes, type) || (index === 0 && type === 'v'), 'Unsupported callback type: ' + type);
    return type === 'p' ? 'i' : type;
  }).join('');
}

export function extractPythonJspiCallbackSignatures(ast) {
  assert.equal(ast.parseDiagnostics.length, 0, 'Pinned glue must parse completely');
  const signatures = new Set();
  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'sig')
        || (ts.isElementAccessExpression(node.left) && ts.isStringLiteral(node.left.argumentExpression)
          && node.left.argumentExpression.text === 'sig'))) {
      assert.ok(ts.isStringLiteral(node.right), 'Callback .sig annotation must be literal');
      signatures.add(normalizeSignature(node.right.text));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(signatures.size > 0, 'Pinned callback catalog must not be empty');
  return [...signatures].sort();
}

export function createPythonJspiCallbackModule(signature) {
  const normalized = normalizeSignature(signature);
  const parameters = Array.from(normalized.slice(1), type => wasmTypeCodes[type]);
  const results = normalized[0] === 'v' ? [] : [wasmTypeCodes[normalized[0]]];
  const typeSection = [1, 96, parameters.length % 128 | 128, parameters.length >> 7, ...parameters,
    results.length | 128, 0, ...results];
  return Uint8Array.from([0,97,115,109,1,0,0,0,1,typeSection.length % 128 | 128,typeSection.length >> 7,
    ...typeSection,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0]);
}

export function createPythonJspiCallbackCatalog(glue) {
  assert.equal(glue.byteLength, 1250344, 'Pinned Pyodide 314.0.6 glue size changed');
  assert.equal(createHash('sha256').update(glue).digest('hex'),
    '2ac5eba365ec12839c75c03b39b3be1dd63b798852cc460b014b52238be042f7', 'Pinned Pyodide 314.0.6 glue SHA-256 changed');
  const ast = ts.createSourceFile('pyodide.asm.mjs', Buffer.from(glue).toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return extractPythonJspiCallbackSignatures(ast).map(signature => ({ signature, bytes: createPythonJspiCallbackModule(signature) }));
}
