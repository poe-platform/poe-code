import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs';
import { createLlmService } from 'safe-bash-command-llm/service';
import { createPythonHostBridge, pythonHostFailureCode } from './host-capabilities.js';
import { pythonLibraryAdapter } from './library-adapter.js';
import { createPythonLlmCapability } from './llm-capability.js';
import { installPythonLlmModule } from './llm-module.js';

test('public Python client preserves host error contracts across buffered and streamed calls', { timeout: 5000 }, async () => {
  let checkpoints = 0;
  let completed = 0;
  const service = createLlmService({ defaultModel: 'text', providers: [{
    name: 'fixture', models: [{ id: 'text' }],
    async *complete(request) {
      completed++;
      if (request.prompt === 'limit') throw new RangeError('private limit detail');
      if (request.prompt === 'timeout') throw Object.assign(new Error('private timeout detail'), { name: 'TimeoutError' });
      if (request.prompt === 'service') throw new Error('private provider detail');
      yield 'ok';
    },
  }] });
  const capability = createPythonLlmCapability({ fs: new MemoryFileSystem(), cwd: '/' }, service);
  const host = createPythonHostBridge({ llm: capability }, { signal: new AbortController().signal });
  const globals = new Map<string, unknown>();
  let source: unknown;
  let registration = '';
  installPythonLlmModule({ globals, runPython(value) {
    source = globals.get('_safe_llm_source');
    registration = value;
  } });
  const program = String.raw`
import sys, json, types, asyncio
bundle = json.loads(sys.stdin.readline())
host = types.ModuleType('safe_host')
class HostError(Exception):
 def __init__(self, message, code):
  super().__init__(message)
  self.code = code
host.HostError = HostError
def send(operation, **fields):
 print(json.dumps(dict(version=1, operation=operation, **fields)), flush=True)
 response = json.loads(sys.stdin.readline())
 if 'error' in response:
  raise HostError(response['error'], response['code'])
 return response['value']
host._send = send
sys.modules['safe_host'] = host
exec(bundle['adapter'])
_safe_llm_source = bundle['source']
exec(bundle['registration'])
from poe_llm import Client, Message, LlmError, LimitError
async def main():
 async with Client(model='text') as client:
  for prompt, history, expected, code in [
   ('history', [Message(role='user', content='before')], LlmError, 'service'),
   ('limit', [], LimitError, 'limit'),
   ('timeout', [], asyncio.TimeoutError, None),
   ('service', [], LlmError, 'service'),
  ]:
   for streaming in (False, True):
    try:
     if streaming:
      async with client.stream(prompt, messages=history) as stream:
       async for event in stream:
        raise AssertionError('failed request emitted an event')
     else:
      await client.complete(prompt, messages=history)
    except expected as error:
     assert type(error) is expected, (type(error), expected)
     assert getattr(error, 'code', None) == code
     assert str(error) == 'Python host operation failed', str(error)
    else:
     raise AssertionError('request unexpectedly succeeded')
   if prompt == 'history':
    send('checkpoint')
   assert (await client.complete('success')).text == 'ok'
   async with client.stream('success') as stream:
    events = [event async for event in stream]
    assert events
asyncio.run(main())
`;
  const child = spawn('python3', ['-B', '-c', program], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  child.stdin.write(JSON.stringify({ source, registration, adapter: pythonLibraryAdapter }) + '\n');
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const request = JSON.parse(line);
      let response;
      try {
        if (request.operation === 'checkpoint') {
          checkpoints++;
          assert.equal(completed, 0);
          response = { value: null };
        } else response = { value: await host.request(request) };
      } catch (error) {
        response = { error: 'Python host operation failed', code: pythonHostFailureCode(error) };
      }
      child.stdin.write(JSON.stringify(response) + '\n');
    }
    assert.equal(await exited, 0, stderr);
    assert.equal(checkpoints, 1);
    assert.equal(completed, 14);
  } finally {
    child.stdin.end();
    child.kill();
    await host.close();
  }
});
