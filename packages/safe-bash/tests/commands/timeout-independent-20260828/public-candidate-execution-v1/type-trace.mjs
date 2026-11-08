import assert from 'node:assert/strict';
import { resolve, relative } from 'node:path';
import { sha } from './common.mjs';
import { assertTypeOutcome } from './t08-predicate.mjs';

export function parseDiagnostics(stdout, source) {
  const rows = [], lines = stdout.replace(/\r\n/gu, '\n').trimEnd().split('\n');
  if (lines.length === 1 && lines[0] === '') return rows;
  for (const line of lines) {
    const match = /^(consumer\.ts)\((\d+),(\d+)\): error TS(\d+): (.*)$/u.exec(line);
    if (match) {
      const sourceLine = source.split('\n')[Number(match[2]) - 1]; assert.ok(sourceLine !== undefined, 'DIAGNOSTIC_OUTSIDE_CONSUMER');
      const tail = sourceLine.slice(Number(match[3]) - 1), token = /^[A-Za-z_$][\w$]*/u.exec(tail)?.[0];
      assert.ok(token, 'DIAGNOSTIC_TOKEN_LOCATION');
      rows.push({ file: match[1], line: Number(match[2]), column: Number(match[3]), code: Number(match[4]), token, message: match[5] });
    } else {
      assert.ok(/^\s+\S/u.test(line) && rows.length > 0, 'UNRELATED_COMPILER_OUTPUT');
      rows.at(-1).message += '\n' + line.trim();
    }
  }
  return rows;
}

export function qualifyType(result, spec, context) {
  assert.equal(result.signal, null, 'COMPILER_SIGNAL'); assert.equal(result.stderr, '', 'COMPILER_STDERR');
  assert.ok(result.records.some(row => row.kind === 'actual-commonjs-compile' && row.compileSha256 === context.compilerHash), 'ACTUAL_TYPESCRIPT_LOAD');
  const expected = new Map(context.packageFiles.map(row => [resolve(context.packageRoot, row.path), row]));
  const authenticatedReads = [], dependencyReads = [], unbound = [];
  let consumerRead = false, packageMetadata = false;
  for (const row of result.records.filter(record => record.kind === 'actual-file-read')) {
    if (row.path === context.consumerPath) { assert.equal(row.sha256, sha(spec.source)); consumerRead = true; continue; }
    if (row.path === context.configPath) { assert.equal(row.sha256, context.configHash); continue; }
    if (row.path === context.consumerPackagePath) { assert.equal(row.sha256, context.consumerPackageHash); continue; }
    if (Object.hasOwn(context.toolMap, row.path)) { assert.equal(row.sha256, context.toolMap[row.path]); dependencyReads.push(row.path); continue; }
    const entry = expected.get(row.path);
    if (!entry) { unbound.push(row); continue; }
    assert.equal(row.sha256, entry.sha256, 'DECLARATION_HASH');
    const path = relative(context.packageRoot, row.path);
    assert.ok(path === 'package.json' || path.endsWith('.d.ts'), 'TYPE_NONDECLARATION_PRODUCT_READ');
    if (path === 'package.json') packageMetadata = true; else authenticatedReads.push(path);
  }
  assert.ok(consumerRead, 'ACTUAL_FROZEN_CONSUMER_READ'); assert.ok(packageMetadata, 'ACTUAL_EXPORT_MAP_READ');
  assert.deepEqual(unbound, [], 'UNBOUND_TYPE_READ');
  const receipt = { exitCode: result.code, authenticatedReads: [...new Set(authenticatedReads)].sort(), dependencyReads: [...new Set(dependencyReads)].sort(), sourceFallback: false, unboundReads: 0, diagnostics: parseDiagnostics(result.stdout, spec.source), rawStdout: result.stdout, rawStderr: result.stderr };
  assertTypeOutcome(receipt, spec); return receipt;
}
