import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonLlmLoaderDiscoveryProgram} from './llm-loader-discovery.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','from importlib.metadata import version; assert version("llm") == "0.27.1"'],{timeout:5000}).status===0;
test('native discovery preserves pinned hook ordering, collisions and raw docstrings',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import llm,json,sys,types,contextlib,io
from importlib.metadata import version
assert version('llm') == '0.27.1'
program=json.load(sys.stdin)
def fragment(value):
 raise AssertionError('discovery executed fragment')
fragment.__doc__='  Fragment 界\n    details\n' + '界' * 5000
def template(value):
 raise AssertionError('discovery executed template')
class Plugin:
 @llm.hookimpl
 def register_fragment_loaders(self,register):
  print('fragment registration')
  register('native',fragment)
  register('native',template)
  register('native_1',fragment)
 @llm.hookimpl
 def register_template_loaders(self,register):
  print('template registration',file=sys.stderr)
  register('native',template)
llm.plugins.load_plugins()
llm.plugins.pm.register(Plugin(),name='discovery-fixture')
messages=[]
def call(capability,message):
 assert capability=='llm_loaders'
 if message['op']=='request': return dict(plugins=[])
 messages.append(message)
sys.modules['safe_host']=types.SimpleNamespace(call=call)
output,error=io.StringIO(),io.StringIO()
with contextlib.redirect_stdout(output),contextlib.redirect_stderr(error):
 exec(program,{})
assert output.getvalue()=='fragment registration\n'
assert error.getvalue()=='template registration\n'
assert messages[-1]==dict(op='done')
assert all(len(message['text'])<=4096 for message in messages[:-1])
actual=json.loads(''.join(message['text'] for message in messages[:-1]))
with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
 expected=dict(fragments=[[prefix,loader.__doc__] for prefix,loader in llm.get_fragment_loaders().items()],templates=[[prefix,loader.__doc__] for prefix,loader in llm.get_template_loaders().items()])
assert actual==expected,(actual,expected)
assert [entry[0] for entry in actual['fragments']]==['native','native_1','native_1_1']
`],{input:JSON.stringify(pythonLlmLoaderDiscoveryProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
