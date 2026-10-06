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

test('targeted native discovery does not run the other loader family hooks',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import llm,json,sys,types
program=json.load(sys.stdin)
calls=[]
class Plugin:
 @llm.hookimpl
 def register_fragment_loaders(self,register):
  calls.append('fragments')
  register('fragment',lambda value: llm.Fragment(value,'fixture'))
 @llm.hookimpl
 def register_template_loaders(self,register):
  calls.append('templates')
  register('template',lambda value: llm.Template(name=value))
llm.plugins.load_plugins()
llm.plugins.pm.register(Plugin(),name='targeted-discovery')
for kind in ('fragments','templates'):
 calls.clear()
 if kind=='fragments': llm.get_fragment_loaders()
 else: llm.get_template_loaders()
 expected=list(calls)
 calls.clear()
 messages=[]
 def call(capability,message):
  if message['op']=='request': return dict(plugins=[],kind=kind)
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=call)
 exec(program,{})
 assert calls==expected,(kind,calls,expected)
 actual=json.loads(''.join(m['text'] for m in messages if m['op']=='text'))
 assert len(actual[kind])==1
 assert actual['templates' if kind=='fragments' else 'fragments']==[]
`],{input:JSON.stringify(pythonLlmLoaderDiscoveryProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});

test('native missing prefixes retain lookup diagnostics before loader execution',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},async()=>{
 const {pythonLlmFragmentProgram}=await import('./llm-fragment-loader.js');
 const {pythonLlmTemplateProgram}=await import('./llm-template-loader.js');
 const result=spawnSync(python,['-B','-c',String.raw`
import llm,json,sys,types
from llm.cli import resolve_fragments,load_template
programs=json.load(sys.stdin)
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
for kind in ('fragment','template'):
 try:
  if kind=='fragment': resolve_fragments(None,['missing:value'])
  else: load_template('missing:value')
  raise AssertionError('native lookup unexpectedly succeeded')
 except Exception as error:
  expected=str(error)
 messages=[]
 def call(capability,message):
  if message['op']=='request': return dict(plugins=[],prefix='missing',value='value')
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=call)
 exec(programs[kind],{})
 assert messages==[dict(op='missing',message=expected)],(kind,messages,expected)
`],{input:JSON.stringify({fragment:pythonLlmFragmentProgram,template:pythonLlmTemplateProgram}),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
