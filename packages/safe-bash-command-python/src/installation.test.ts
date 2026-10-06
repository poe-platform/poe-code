import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePythonInstallation } from "./installation.js";

test('pip installation parses explicit pins, local wheels and requirement files', () => {
  assert.deepEqual(parsePythonInstallation(['install', 'docx==1.2.0', './local.whl', '-r', 'req.txt', '--requirement=more.txt']), {
    packages: ['docx==1.2.0', './local.whl'], requirements: ['req.txt', 'more.txt'], help: false,
  });
});
test('unsupported pip commands and every unknown option fail explicitly', () => {
  for (const option of ['--no-index', '--upgrade', '--no-deps', '--target=/tmp', '--user', '--index-url', '--trusted-host', '--require-hashes', '--dry-run', '--quiet', '-e']) {
    assert.throws(() => parsePythonInstallation(['install', option]), new RegExp('unsupported pip option'));
  }
  assert.throws(() => parsePythonInstallation(['list', 'x']), /unsupported pip command/);
  assert.throws(() => parsePythonInstallation(['install']), /at least one/);
  assert.throws(() => parsePythonInstallation(['install', '-r']), /requires a path/);
});
test('pip help is available without packages', () => {
  assert.equal(parsePythonInstallation(['--help'])?.help, true);
  assert.equal(parsePythonInstallation(['install', '--help'])?.help, true);
  assert.throws(() => parsePythonInstallation(['--help', '--index-url', 'bad']), /unsupported pip option/);
});

test('pip uninstall preserves targets and explicit confirmation without treating targets as installs',()=>{
 assert.deepEqual(parsePythonInstallation(['uninstall','First','-y','second']),{packages:['First','second'],requirements:[],help:false,uninstall:true,yes:true});
 assert.deepEqual(parsePythonInstallation(['uninstall','first']),{packages:['first'],requirements:[],help:false,uninstall:true,yes:false});
 assert.throws(()=>parsePythonInstallation(['uninstall','--upgrade','first']),/unsupported pip option/);
 assert.throws(()=>parsePythonInstallation(['uninstall']),/at least one/);
});

test('pip install preserves prerelease selection and cache bypass',()=>{
 assert.deepEqual(parsePythonInstallation(['install','--pre','--no-cache-dir','fixture']),{packages:['fixture'],requirements:[],help:false,pre:true,noCache:true});
 assert.throws(()=>parsePythonInstallation(['uninstall','--pre','fixture']),/unsupported pip option/);
});
