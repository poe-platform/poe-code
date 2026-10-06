import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonLlmTemplateProgram} from './llm-template-loader.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','from importlib.metadata import version; assert version("llm") == "0.27.1"'],{timeout:5000}).status===0;
test('native template bridge matches pinned fields, validation, output and loader calls',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import llm,json,sys,types,contextlib,io
program=json.load(sys.stdin)
calls=[]
def loader(value):
 calls.append(value)
 if value=='error': raise ValueError('native template failure')
 print('template output')
 print('template diagnostic',file=sys.stderr)
 return llm.Template(name='native',prompt='界'*5000+' $name $input',system='system',model='fixture',defaults={'name':'Ada'},options={'temperature':0.5},attachments=['image.png'],attachment_types=[{'type':'image/png','value':'second.png'}],extract=True,extract_last=False,schema_object={'type':'object'},fragments=['fragment.txt'],system_fragments=['system.txt'],tools=['tool'],functions='def tool(): return 1')
class Plugin:
 @llm.hookimpl
 def register_template_loaders(self,register): register('native',loader)
llm.plugins.load_plugins()
llm.plugins.pm.register(Plugin(),name='template-fixture')
for value in ('input','error'):
 messages=[]
 def call(capability,message):
  assert capability=='llm_templates'
  if message['op']=='request': return dict(prefix='native',value=value,plugins=[])
  messages.append(message)
 sys.modules['safe_host']=types.SimpleNamespace(call=call)
 output,error=io.StringIO(),io.StringIO()
 with contextlib.redirect_stdout(output),contextlib.redirect_stderr(error):
  exec(program,{})
 if value=='error':
  assert messages==[dict(op='error',message='native template failure')]
 else:
  assert output.getvalue()=='template output\n'
  assert error.getvalue()=='template diagnostic\n'
  assert messages[-1]==dict(op='done')
  assert all(len(message['text'])<=4096 for message in messages[:-1])
  actual=json.loads(''.join(message['text'] for message in messages[:-1]))
  with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
   expected=llm.get_template_loaders()['native'](value)
  assert actual==expected.model_dump(exclude_none=True)
  assert llm.Template(**actual).evaluate('question',{'name':'Grace'})==expected.evaluate('question',{'name':'Grace'})
  assert not expected._functions_is_trusted
assert calls==['input','input','error']
`],{input:JSON.stringify(pythonLlmTemplateProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
