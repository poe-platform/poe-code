import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installPythonShellModule } from '../../src/commands/python/shell-module.js';

test('Python shell and ordinary subprocess preserve literal argv, bytes and compatible errors', () => {
  let source = '';
  let registration = '';
  installPythonShellModule({ globals: { set(_name, value) { source = String(value); }, delete() {} }, runPython(value) { registration = value; } });
  const program = String.raw`
import sys,json,types,asyncio,unittest
bundle=json.load(sys.stdin)
_safe_shell_source=bundle['source']
exec(bundle['registration'])
del _safe_shell_source
from poe_shell import Client, ShellError
import subprocess
class Bridge:
 def __init__(self): self.calls=[]
 def call(self, operation, payload):
  self.calls.append((operation,payload))
  if payload.get('timeout') == 0.01: return {'error': {'code': 'timeout', 'message': 'deadline', 'stdout': [255], 'stderr': [0]}}
  return {'returncode': 7 if payload.get('argv', [''])[0] == 'fail' else 0, 'stdout': [255,0,42], 'stderr': [97]}
 def stream(self,payload):
  async def events():
   try:
    yield {'type':'stdout','data':[255,0]}
    yield {'type':'result','returncode':0}
   finally: self.closed=True
  return events()
class Cases(unittest.IsolatedAsyncioTestCase):
 async def test_direct(self):
  bridge=Bridge()
  async with Client(bridge=bridge) as client:
   result=await client.run(['echo','$(secret)','two words'], input=b'\xff\0', cwd='/project', env={'ONLY':'x'}, timeout=2)
   self.assertEqual(result.stdout,b'\xff\0*')
   self.assertEqual(result.stderr,b'a')
   payload=bridge.calls[-1][1]
   self.assertEqual(payload['argv'],['echo','$(secret)','two words'])
   self.assertEqual(payload['input'],[255,0])
   self.assertEqual(payload['env'],{'ONLY':'x'})
   await client.script('echo x | cat')
   self.assertEqual(bridge.calls[-1][1]['script'],'echo x | cat')
   async with client.stream(['echo','literal']) as stream:
    async for event in stream:
     self.assertEqual(event.data,b'\xff\0')
     break
   self.assertTrue(bridge.closed)
  with self.assertRaises(ShellError): await client.run(['echo'])
 async def test_subprocess(self):
  bridge=Bridge()
  cap=types.ModuleType('_poe_shell_capability'); cap.bridge=bridge
  sys.modules['_poe_shell_capability']=cap
  result=subprocess.run(['rg','TODO','/project'],capture_output=True,text=True,encoding='latin1')
  self.assertIsInstance(result,subprocess.CompletedProcess)
  self.assertEqual(result.args,['rg','TODO','/project'])
  self.assertEqual(result.stdout,'ÿ\0*')
  self.assertEqual(result.stderr,'a')
  self.assertEqual(subprocess.check_output(['cat'],input=b'\0'),b'\xff\0*')
  with self.assertRaises(subprocess.CalledProcessError) as failed:
   subprocess.run(['fail'],capture_output=True,check=True)
  self.assertEqual(failed.exception.returncode,7)
  self.assertEqual(failed.exception.stderr,b'a')
  with self.assertRaises(subprocess.TimeoutExpired) as timeout:
   subprocess.run(['cat'],capture_output=True,timeout=0.01)
  self.assertEqual(timeout.exception.output,b'\xff')
  subprocess.run('echo x | cat',shell=True,capture_output=True)
  self.assertEqual(bridge.calls[-1][1]['script'],'echo x | cat')
  for options in [{'start_new_session':True},{'stdout':123},{'shell':True}]:
   with self.assertRaises((ValueError,NotImplementedError,TypeError)):
    subprocess.run(['echo'],**options)
  with self.assertRaises(NotImplementedError): subprocess.Popen(['echo'])
  bridge.call=lambda operation,payload: {'returncode':0,'stdout':[97,13,10,98,13,99],'stderr':[]}
  self.assertEqual(subprocess.run(['cat'],capture_output=True,text=True).stdout,'a\nb\nc')
unittest.main()
`;
  const result = spawnSync('python3', ['-B', '-c', program], { input: JSON.stringify({ source, registration }), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 2 tests/u);
});
