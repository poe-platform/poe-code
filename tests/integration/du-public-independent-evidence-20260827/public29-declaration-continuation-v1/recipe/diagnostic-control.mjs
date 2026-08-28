import assert from 'node:assert/strict';
export function diagnosticProof(result, expected) {
  assert.equal(result.signal, null); assert.equal(result.stderr, ''); assert.equal(result.code, expected.exitCode, result.stdout);
  const diagnostics = result.stdout.trim() ? result.stdout.trim().split('\n').map(line => {
    const match = /^consumer\.ts\((\d+),(\d+)\): error TS(\d+): (.*)$/u.exec(line);
    assert.ok(match, `UNCLASSIFIED_DIAGNOSTIC:${line}`);
    return { line: Number(match[1]), column: Number(match[2]), code: Number(match[3]), text: match[4] };
  }) : [];
  assert.equal(diagnostics.length, expected.diagnostics.length, result.stdout);
  for (let index = 0; index < diagnostics.length; index++) {
    const actual = diagnostics[index], wanted = expected.diagnostics[index];
    assert.equal(actual.line, wanted.line); assert.equal(actual.code, wanted.code); assert.ok(actual.text.includes(wanted.mentions));
  }
  return diagnostics;
}
