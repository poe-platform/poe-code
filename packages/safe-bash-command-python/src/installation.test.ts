import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePythonInstallation } from "./installation.js";

test('pip installation parses explicit pins, local wheels and requirement files', () => {
  assert.deepEqual(parsePythonInstallation(['install', 'docx==1.2.0', './local.whl', '-r', 'req.txt', '--requirement=more.txt']), {
    packages: ['docx==1.2.0', './local.whl'], requirements: ['req.txt', 'more.txt'], help: false, controls: {},
  });
});
test('unsupported pip commands and every unknown option fail explicitly', () => {
  for (const option of ['--no-index', '--target=/tmp', '--user', '--index-url', '--trusted-host', '--require-hashes', '--dry-run', '--quiet']) {
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
 assert.deepEqual(parsePythonInstallation(['uninstall','First','-y','second']),{packages:['First','second'],requirements:[],help:false,controls:{},uninstall:true,yes:true});
 assert.deepEqual(parsePythonInstallation(['uninstall','first']),{packages:['first'],requirements:[],help:false,controls:{},uninstall:true,yes:false});
 assert.throws(()=>parsePythonInstallation(['uninstall','--upgrade','first']),/unsupported pip option/);
 assert.throws(()=>parsePythonInstallation(['uninstall']),/at least one/);
});

test('pip install preserves prerelease selection and cache bypass',()=>{
 assert.deepEqual(parsePythonInstallation(['install','--pre','--no-cache-dir','fixture']),{packages:['fixture'],requirements:[],help:false,controls:{pre:true,noCache:true}});
 assert.throws(()=>parsePythonInstallation(['uninstall','--pre','fixture']),/unsupported pip option/);
});

test('pip upgrade and force-reinstall select install policies',()=>{
 for(const flag of ['-U','--upgrade'])assert.equal(parsePythonInstallation(['install',flag,'fixture']).controls.upgrade,true);
 assert.equal(parsePythonInstallation(['install','--force-reinstall','fixture']).controls.forceReinstall,true);
 assert.throws(()=>parsePythonInstallation(['uninstall','--force-reinstall','fixture']),/unsupported pip option/);
});

test('editable install arguments preserve repeated source paths independently of ordinary roots',()=>{
  assert.deepEqual(parsePythonInstallation(['install','fixture','-e','./source','--editable=/other','-e./third']).controls,{editable:['./source','/other','./third']});
  assert.equal(parsePythonInstallation(['install','--editable','./source']).help,false);
  for(const flag of ['-e','--editable','--editable='])assert.throws(()=>parsePythonInstallation(['install',flag]),/requires a path/);
  assert.throws(()=>parsePythonInstallation(['uninstall','-e','./source']),/unsupported pip option/);
 });

test('pip constraint arguments stay independent of requested packages',()=>{
 assert.deepEqual(parsePythonInstallation(['install','alpha','-c','pins','--constraint=more','-cthird']).controls,{constraintFiles:['pins','more','third']});
 assert.throws(()=>parsePythonInstallation(['uninstall','alpha','-c','pins']),/unsupported pip option/);
 assert.throws(()=>parsePythonInstallation(['install','-c']),/requires a path/);
});

 test('pip dependency suppression accepts native aliases only for installation',()=>{
 for(const flag of ['--no-deps','--no-dependencies']){
  assert.deepEqual(parsePythonInstallation(['install',flag,'root']).controls,{noDeps:true});
  assert.throws(()=>parsePythonInstallation(['uninstall',flag,'root']),/unsupported pip option/);
 }
 });
