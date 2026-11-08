import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const archive = realpathSync(request.archive);
const require = createRequire(resolve(archive, 'package.json'));
const ts = require('typescript');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originalRead = ts.sys.readFile;
const reads = [];
ts.sys.readFile = (path, encoding) => {
  const text = originalRead(path, encoding);
  if (text === undefined) return text;
  const actual = realpathSync(path);
  const before = hash(readFileSync(path));
  assert.equal(before, request.files[actual], `Unexpected compiler input: ${actual}`);
  const after = hash(readFileSync(path));
  assert.equal(after, before);
  reads.push({ path: actual, before, after, expected: request.files[actual] });
  return text;
};
const config = ts.readConfigFile(resolve(archive, 'tsconfig.json'), ts.sys.readFile);
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, archive);
const roots = ['src/commands/execution.ts', 'src/commands/env-split.ts'].map(path => resolve(archive, path));
const options = { ...parsed.options, noEmit: true };
const program = ts.createProgram(roots, options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(item => ({
  code: item.code,
  category: item.category,
  file: item.file?.fileName ?? null,
  start: item.start ?? null,
  message: ts.flattenDiagnosticMessageText(item.messageText, '\n'),
}));
console.log(JSON.stringify({ version: ts.version, roots, options, reads, diagnostics }));
process.exitCode = diagnostics.length ? 1 : 0;
