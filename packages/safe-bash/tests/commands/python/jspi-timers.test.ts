import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { pythonJspiTimers } from '../../../src/commands/python/runtime-scripts.js';
import { pythonExecution } from '../../../src/commands/python/execution.js';

test('guest timers are cancelled before error reporting and output flushing while cleanup can schedule new work', () => {
  const program = `
import asyncio, json, sys, io
bundle = json.load(sys.stdin)
original_flags = sys.flags
class Flags:
 safe_path = False
 def __getattr__(self, name):
  return getattr(original_flags, name)
sys.flags = Flags()
for source in ['pass', 'raise ValueError("example")']:
 scope = {"__name__": "__main__"}
 exec(bundle['timers'], scope)
 loop = asyncio.get_event_loop()
 handles = [loop.call_later(60, lambda: None)]
 class Output(io.StringIO):
  def flush(self):
   assert handles[0].cancelled(), 'Timer survived into output flushing'
 def report(*args):
  assert handles[0].cancelled(), 'Timer survived into exception reporting'
 original = sys.stdout, sys.stderr, sys.stdin, sys.excepthook
 sys.stdout, sys.stderr, sys.excepthook = Output(), Output(), report
 sys.stdin = io.TextIOWrapper(io.BytesIO(source.encode()))
 scope['_safe_invocation_json'] = json.dumps({'args': ['-'], 'cwd': '/', 'env': {}})
 try:
  exec(bundle['execution'], scope)
  assert scope['_safe_exit'] == (0 if source == 'pass' else 1)
  assert handles[0].cancelled()
  future = loop.create_future()
  loop.call_soon(future.set_result, 42)
  assert loop.run_until_complete(future) == 42
 finally:
  sys.stdout, sys.stderr, sys.stdin, sys.excepthook = original
  loop.call_later = scope['_safe_original_call_later']
loop.close()
`;
  const result = spawnSync('python3', ['-B', '-c', program], {
    input: JSON.stringify({ timers: pythonJspiTimers, execution: pythonExecution }),
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
