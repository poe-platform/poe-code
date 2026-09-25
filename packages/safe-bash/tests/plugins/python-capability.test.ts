import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installPythonLlmModule } from '../../src/commands/python/llm-module.js';
import { installPythonCapabilityModule } from '../../src/commands/python/capability-module.js';

test('native data-only bridge preserves options and retires stream handles on early exit', () => {
  let script = '';
  installPythonCapabilityModule({ runPython(source) { script = source; } });
  let llmSource = '';
  let llmRegistration = '';
  installPythonLlmModule({globals:{set(_name,value){llmSource=String(value);},delete(){}},runPython(source){llmRegistration=source;}});
  const program = String.raw`
import sys,json,types,asyncio
bundle=json.load(sys.stdin)
script=bundle['script']
_safe_llm_source=bundle['llmSource']
exec(bundle['llmRegistration'])
del _safe_llm_source
calls=[]
def request(encoded):
 op,operation,payload=json.loads(encoded)
 assert op=='capability'
 calls.append((operation,payload))
 if payload.get('invalid'): value={'error':{'code':'invalid_option','message':'Unsupported option'}}
 elif operation.endswith('.open'): value={'handle':'invocation-stream'}
 elif operation.endswith('.next'): value={'done':False,'value':{'type':'text','text':'answer'}}
 else: value={'model':'fake/model','options':payload.get('options')}
 return json.dumps({'value':value})
native=types.ModuleType('_safe_native_fs'); native.request=request
sys.modules['_safe_native_fs']=native
exec(script)
from _poe_llm_capability import bridge
from _poe_shell_capability import bridge as shell
async def main():
 result=await bridge.call('complete',{'options':{'temperature':0.25,'cache':True}})
 assert result['options']=={'temperature':0.25,'cache':True}
 from poe_llm import LlmError
 try:
  await bridge.call('complete',{'invalid':True})
 except LlmError as error:
  assert error.code == 'invalid_option'
 else:
  raise AssertionError('Host service error was not translated')
 stream=bridge.stream({'prompt':'hello'})
 assert (await stream.__anext__())['text']=='answer'
 await stream.aclose()
 assert calls[-1]==('llm.stream.close',{'handle':'invocation-stream'})
 assert shell.call('run',{'argv':['echo','$(secret)']})['model']=='fake/model'
 assert calls[-1][1]['argv']==['echo','$(secret)']
asyncio.run(main())
`;
  const result = spawnSync('python3', ['-c', program], { input: JSON.stringify({script,llmSource,llmRegistration}), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
