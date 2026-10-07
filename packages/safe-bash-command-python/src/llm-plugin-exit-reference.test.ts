import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonLlmTemplateProgram} from './llm-template-loader.js';
import {pythonLlmFragmentProgram} from './llm-fragment-loader.js';
import {pythonLlmLoaderDiscoveryProgram} from './llm-loader-discovery.js';
import {pythonLlmFunctionsProgram} from './llm-functions-program.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','from importlib.metadata import version; assert version("llm") == "0.27.1"'],{timeout:5000}).status===0;
test('native plugin SystemExit survives lookup, execution and discovery without becoming an ordinary error',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types,llm
from llm.cli import load_template,resolve_fragments
programs=json.load(sys.stdin)
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
current={}
def halt(): raise SystemExit(current['code'])
def loader(value): halt()
class Plugin:
 @llm.hookimpl
 def register_template_loaders(self,register):
  if current['stage']=='lookup': halt()
  register('native',loader)
 @llm.hookimpl
 def register_fragment_loaders(self,register):
  if current['stage']=='lookup': halt()
  register('native',loader)
llm.plugins.load_plugins()
llm.plugins.pm.register(Plugin(),name='exit-fixture')
for code in (None,0,7,'plugin exit diagnostic'):
 for stage in ('lookup','execution'):
  current.update(code=code,stage=stage)
  for kind in ('fragment','template'):
   try:
    if kind=='fragment': resolve_fragments(None,['native:value'])
    else: load_template('native:value')
   except SystemExit as error: assert error.code==code
   else: raise AssertionError('reference swallowed plugin exit')
   messages=[]
   def call(capability,message):
    if message['op']=='request':return dict(plugins=[],prefix='native',value='value')
    messages.append(message)
   sys.modules['safe_host']=types.SimpleNamespace(call=call)
   try:exec(programs[kind],{})
   except SystemExit as error: assert error.code==code
   else:raise AssertionError('bridge swallowed plugin exit')
   assert messages==[dict(op='exit')],(kind,stage,code,messages)
  if stage=='lookup':
   messages=[]
   try:exec(programs['discovery'],{})
   except SystemExit as error:assert error.code==code
   else:raise AssertionError('discovery swallowed plugin exit')
   assert messages==[dict(op='exit')]
`],{input:JSON.stringify({template:pythonLlmTemplateProgram,fragment:pythonLlmFragmentProgram,discovery:pythonLlmLoaderDiscoveryProgram}),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});

test('native tool definition SystemExit retains CLI status and bridge exit marker',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types
from click.testing import CliRunner
from llm.cli import cli
program=json.load(sys.stdin)
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=None)
for code,status,output in ((None,0,''),(0,0,''),(7,7,''),('tool exit',1,'tool exit\n')):
 definition='raise SystemExit('+repr(code)+')'
 result=CliRunner().invoke(cli,['tools','--functions',definition])
 assert (result.exit_code,result.output)==(status,output),(code,result.exit_code,result.output)
 messages=[]
 def call(capability,message):
  if message['op']=='definitions':return [definition]
  if message['op']=='selection':return dict(discovery=True)
  if message['op']=='admit':return None
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=call)
 try:exec(program,{})
 except SystemExit as error:assert error.code==code
 else:raise AssertionError('bridge swallowed tool initialization exit')
 assert messages==[dict(op='exit')],messages
`],{input:JSON.stringify(pythonLlmFunctionsProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
