import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installPythonJspiRunSync } from '../../../src/commands/python/jspi-run-sync.js';

test('JSPI run_sync keeps Python exceptions on the Python side of the promising boundary', () => {
  let source = '';
  installPythonJspiRunSync({runPython(value) {source = value;}});
  const program = `
import sys, types, asyncio, json
ffi = types.ModuleType('pyodide.ffi')
pyodide = types.ModuleType('pyodide')
pyodide.ffi = ffi
sys.modules['pyodide'] = pyodide
sys.modules['pyodide.ffi'] = ffi
calls = 0
def original(awaitable):
 global calls
 calls += 1
 try:
  return asyncio.run(awaitable)
 except BaseException:
  raise RuntimeError('fatal promising rejection')
ffi.run_sync = original
exec(json.load(sys.stdin))
async def success():
 return 42
assert ffi.run_sync(success()) == 42
for expected in [ValueError, asyncio.TimeoutError, asyncio.CancelledError]:
 async def failure():
  raise expected('expected')
 try:
  ffi.run_sync(failure())
 except BaseException as error:
  assert isinstance(error, expected), repr(error)
 else:
  raise AssertionError('exception swallowed')
assert calls == 4
`;
  const result = spawnSync('python3',['-B','-c',program],{input:JSON.stringify(source),encoding:'utf8',timeout:5000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
