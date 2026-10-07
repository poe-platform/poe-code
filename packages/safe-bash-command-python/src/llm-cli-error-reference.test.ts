import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonLlmFunctionsProgram} from './llm-functions-program.js';
import {pythonLlmTemplateProgram} from './llm-template-loader.js';
import {pythonLlmFragmentProgram} from './llm-fragment-loader.js';
import {pythonLlmLoaderDiscoveryProgram} from './llm-loader-discovery.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','from importlib.metadata import version; assert version("llm") == "0.27.1"'],{timeout:5000}).status===0;
test('native Click plugin failures preserve custom rendering and process status',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import contextlib,io,json,sys,types,llm,click
from click.testing import CliRunner
from llm.cli import cli
programs=json.load(sys.stdin)
class Failure(click.ClickException):
 exit_code=9
 def format_message(self):return 'formatted plugin failure'
def fail():raise Failure('raw plugin failure')
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
definition='import click as _click\nclass _Failure(_click.ClickException):\n exit_code=9\n def format_message(self):return "formatted plugin failure"\nraise _Failure("raw plugin failure")'
sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda value:value.type)
sys.modules['_poe_llm_capability']=types.SimpleNamespace(bridge=None)
for kind,args in [('tools',['tools','--functions',definition]),('template',['-t','native:value','question']),('fragment',['-f','native:value','question']),('discovery',['templates','loaders'])]:
 reference=CliRunner(mix_stderr=False).invoke(cli,args)
 assert (reference.exit_code,reference.stdout,reference.stderr)==(9,'','Error: formatted plugin failure\n'),(kind,reference.exit_code,reference.output,reference.exception)
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
