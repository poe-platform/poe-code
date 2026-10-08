import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadPythonPackageProgram} from './package-program.js';
test('the cached package program preserves its maintained Python source exactly',async()=>{
 const first=loadPythonPackageProgram();assert.equal(loadPythonPackageProgram(),first);
 assert.equal(await first,await readFile(new URL('./source-origin-program.py',import.meta.url),'utf8')+await readFile(new URL('./metadata-discovery.py',import.meta.url),'utf8')+await readFile(new URL('./package-program.py',import.meta.url),'utf8'));
});

import {loadPythonNativeWheel,pythonNativeWheel} from './native-wheel.js';
test('the cached native wheel program preserves its maintained source exactly',async()=>{
 const first=loadPythonNativeWheel();assert.equal(loadPythonNativeWheel(),first);
 assert.equal(await first,pythonNativeWheel);
});

import {loadPythonBuildBackendProgram,pythonBuildBackendProgram} from './build-backend.js';
test('the cached build backend program preserves its maintained source exactly',async()=>{
 const first=loadPythonBuildBackendProgram();assert.equal(loadPythonBuildBackendProgram(),first);
 assert.equal(await first,pythonBuildBackendProgram);
});

import {loadPythonLlmFunctionsProgram,pythonLlmFunctionsProgram} from './llm-functions-program.js';
test('the cached tool program preserves its maintained source and exit handling exactly',async()=>{
 const first=loadPythonLlmFunctionsProgram();assert.equal(loadPythonLlmFunctionsProgram(),first);
 assert.equal(await first,pythonLlmFunctionsProgram);
});
