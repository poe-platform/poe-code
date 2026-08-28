import assert from 'node:assert/strict';
import { serializePublicAst } from './instrumentation.mjs';

export function captureAstCases(api, cases) {
  assert.equal(typeof api.parseShell, 'function');
  assert.deepEqual(cases.map(row => row.id), ['AST01','AST02','AST03','AST04']);
  return cases.map(row => {
    assert.equal(typeof row.script, 'string'); assert.ok(row.script.length <= 4096);
    return { id: row.id, script: row.script, value: serializePublicAst(api.parseShell(row.script)) };
  });
}
export function compatibleAst(api, row, baseline) {
  assert.equal(baseline.id, row.id); assert.equal(baseline.script, row.script);
  const actual = serializePublicAst(api.parseShell(row.script));
  assert.deepEqual(actual, baseline.value, 'unchanged public own-data AST against independently loaded old package');
  return true;
}
