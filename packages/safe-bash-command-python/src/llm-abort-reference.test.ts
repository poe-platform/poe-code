import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonLlmFunctionsProgram} from './llm-functions-program.js';
import {pythonLlmTemplateProgram} from './llm-template-loader.js';
import {pythonLlmFragmentProgram} from './llm-fragment-loader.js';
import {pythonLlmLoaderDiscoveryProgram} from './llm-loader-discovery.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','from importlib.metadata import version; assert version("llm") == "0.27.1"'],{timeout:5000}).status===0;
for(const exception of ['EOFError','click.Abort'])test(`native ${exception} distinguishes discovery aborts from loader errors`,{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import contextlib,io,json,sys,types,llm,click
from click.testing import CliRunner
from llm.cli import cli
programs=json.load(sys.stdin)
def fail():raise ${exception}('raw plugin failure')
stage='lookup'
class Plugin:
 @llm.hookimpl
 def register_template_loaders(self,register):
  if stage=='lookup':fail()
  register('native',lambda value:fail())
 @llm.hookimpl
 def register_fragment_loaders(self,register):
  if stage=='lookup':fail()
  register('native',lambda value:fail())
llm.plugins.load_plugins()
llm.plugins.pm.register(Plugin(),name='click-error-fixture')
definition='import click\nraise ${exception}("raw plugin failure")'
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=None)
for kind,args in [('tools',['tools','--functions',definition]),('template',['-t','native:value','question']),('fragment',['-f','native:value','question']),('discovery',['templates','loaders'])]:
 reference=CliRunner(mix_stderr=False).invoke(cli,args)
 assert (reference.exit_code,reference.stdout,reference.stderr)==(1,'',${exception === 'EOFError' ? '"\\nAborted!\\n"' : '"Aborted!\\n"'}),(kind,reference.exit_code,reference.output,reference.exception)
 messages=[]
 def call(capability,message):
  if message['op']=='request':return dict(plugins=[],prefix='native',value='value')
  if message['op']=='definitions':return [definition]
  if message['op']=='selection':return {}
  if message['op']=='admit':return None
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=call)
 stdout,stderr=io.StringIO(),io.StringIO()
 with contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):
  try:exec(programs[kind],{})
  except SystemExit as error:assert error.code==reference.exit_code
  else:raise AssertionError('bridge swallowed native Click failure')
 assert messages==[dict(op='exit')],(kind,messages)
 assert (stdout.getvalue(),stderr.getvalue())==(reference.stdout,reference.stderr),(kind,stdout.getvalue(),stderr.getvalue())
stage='execution'
for kind,args in [('template',['-t','native:value','question']),('fragment',['-f','native:value','question'])]:
 reference=CliRunner(mix_stderr=False).invoke(cli,args)
 assert reference.exit_code==1,(kind,reference.exception)
 assert 'raw plugin failure' in reference.stderr and 'formatted plugin failure' not in reference.stderr,reference.stderr
 messages=[]
 stdout,stderr=io.StringIO(),io.StringIO()
 with contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):exec(programs[kind],{})
 assert messages==[dict(op='error',message='raw plugin failure')],messages
 assert stdout.getvalue()==stderr.getvalue()==''
`],{input:JSON.stringify({tools:pythonLlmFunctionsProgram,template:pythonLlmTemplateProgram,fragment:pythonLlmFragmentProgram,discovery:pythonLlmLoaderDiscoveryProgram}),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});

for(const exception of ['EOFError','click.Abort'])test(`native ${exception} aborts toolbox preparation`,{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types,asyncio,llm,click,contextlib,io
from click.testing import CliRunner
program=json.load(sys.stdin)
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
llm.plugins.load_plugins()
for code in (1,):
 for asynchronous in (False,True):
  definition='import click\nimport llm as _llm\nclass _ExitBox(_llm.Toolbox):\n '+('async def prepare_async' if asynchronous else 'def prepare')+'(self):\n  raise ${exception}("raw preparation failure")\n def halt(self): return "unreachable"'
  namespace={}
  exec(definition,namespace)
  instance=namespace['_ExitBox']()
  tool=llm.Tool.function(instance.halt)
  async def calls():return [llm.ToolCall(name=tool.name,arguments={})]
  response=types.SimpleNamespace(prompt=types.SimpleNamespace(tools=[tool]),tool_calls=calls if asynchronous else lambda:[llm.ToolCall(name=tool.name,arguments={})])
  @click.command()
  def native():
   if asynchronous:asyncio.run(llm.AsyncResponse.execute_tool_calls(response))
   else:llm.Response.execute_tool_calls(response)
  reference=CliRunner(mix_stderr=False).invoke(native,[])
  assert (reference.exit_code,reference.stdout,reference.stderr)==(code,'',${exception === 'EOFError' ? '"\\nAborted!\\n"' : '"Aborted!\\n"'})
  definition+='\nclass _Plugin:\n @_llm.hookimpl\n def register_tools(self,register):register(_ExitBox,name="ExitBox")\n_llm.plugins.pm.register(_Plugin(),name="exit-preparation")'
  messages=[]
  def call(capability,message):
   if message['op']=='definitions':return [definition]
   if message['op']=='selection':return dict(names=['ExitBox'])
   messages.append(message)
  sys.modules['safe_host']=types.SimpleNamespace(call=call)
  called=False
  async def wait(*args,**kwargs):
   global called
   if not called:
    called=True
    return dict(id=1,prepare=True,asynchronous=asynchronous)
   await asyncio.sleep(0)
   return None
  sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=types.SimpleNamespace(wait=wait))
  stderr=io.StringIO()
  try:
   with contextlib.redirect_stderr(stderr):exec(program,{})
  except SystemExit as error:assert error.code==code
  else:raise AssertionError('bridge swallowed preparation exit')
  finally:llm.plugins.pm.unregister(name='exit-preparation')
  assert stderr.getvalue()==${exception === 'EOFError' ? '"\\nAborted!\\n"' : '"Aborted!\\n"'},stderr.getvalue()
  assert messages[-1]==dict(op='exit'),messages
  assert not any(message['op'] in ('done','error','failed') for message in messages)
`],{input:JSON.stringify(pythonLlmFunctionsProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stderr,'');
});

for(const exception of ['EOFError','click.Abort'])test(`native ${exception} remains an ordinary tool result`,{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,types,asyncio,llm,click
program=json.load(sys.stdin)
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
for asynchronous in (False,True):
 definition='import click\n'+('async ' if asynchronous else '')+'def halt():raise ${exception}("raw tool failure")'
 namespace={}
 exec(definition,namespace)
 tool=llm.Tool.function(namespace['halt'])
 response=types.SimpleNamespace(prompt=types.SimpleNamespace(tools=[tool]),tool_calls=lambda:[llm.ToolCall(name='halt',arguments={})])
 results=llm.Response.execute_tool_calls(response)
 assert results[0].output=='Error: raw tool failure'
 messages=[]
 def call(capability,message):
  if message['op']=='definitions':return [definition]
  if message['op']=='selection':return {}
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=call)
 called=False
 async def wait(*args,**kwargs):
  global called
  if not called:
   called=True
   return dict(id=1,tool=0,arguments={})
  await asyncio.sleep(0)
  return None
 sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=types.SimpleNamespace(wait=wait))
 exec(program,{})
 assert messages[-1]==dict(op='error',id=1,message='raw tool failure'),messages
 assert not any(message['op']=='exit' for message in messages)
`],{input:JSON.stringify(pythonLlmFunctionsProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stderr,'');
});
