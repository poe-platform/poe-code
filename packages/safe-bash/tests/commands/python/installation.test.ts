import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePythonInstallation } from '../../../src/commands/python/installation.js';

test('pip installation parses explicit pins, local wheels and requirement files', () => {
  assert.deepEqual(parsePythonInstallation(['-B', '-m', 'pip', 'install', 'docx==1.2.0', './local.whl', '-r', 'req.txt', '--requirement=more.txt']), {
    packages: ['docx==1.2.0', './local.whl'], requirements: ['req.txt', 'more.txt'], help: false,
  });
});
test('pip interception respects Python option operands and entrypoint boundaries', () => {
  for (const args of [['-c', '-m pip'], ['script.py', '-m', 'pip'], ['-m', 'other', 'pip'], ['--', '-m', 'pip'], ['-W', '-m', 'file.py']]) {
    assert.equal(parsePythonInstallation(args), undefined);
  }
  assert.deepEqual(parsePythonInstallation(['-Bmpip', 'install', 'pypdf==6.18.1'])?.packages, ['pypdf==6.18.1']);
});
test('unsupported pip commands and every unknown option fail explicitly', () => {
  for (const option of ['--no-index', '--upgrade', '--no-deps', '--target=/tmp', '--user', '--index-url', '--trusted-host', '--require-hashes', '--dry-run', '--quiet', '-e', '--no-cache-dir']) {
    assert.throws(() => parsePythonInstallation(['-m', 'pip', 'install', option]), new RegExp('unsupported pip option'));
  }
  assert.throws(() => parsePythonInstallation(['-m', 'pip', 'uninstall', 'x']), /unsupported pip command/);
  assert.throws(() => parsePythonInstallation(['-m', 'pip', 'install']), /at least one/);
  assert.throws(() => parsePythonInstallation(['-m', 'pip', 'install', '-r']), /requires a path/);
});
test('pip help is available without packages', () => {
  assert.equal(parsePythonInstallation(['-m', 'pip', '--help'])?.help, true);
  assert.equal(parsePythonInstallation(['-m', 'pip', 'install', '--help'])?.help, true);
  assert.throws(() => parsePythonInstallation(['-m', 'pip', '--help', '--index-url', 'bad']), /unsupported pip option/);
});
