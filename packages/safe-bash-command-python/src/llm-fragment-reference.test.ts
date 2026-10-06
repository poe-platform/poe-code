import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonLlmFragmentProgram} from './llm-fragment-loader.js';
const python=process.env.LLM_TEST_PYTHON??'python3';
const available=spawnSync(python,['-B','-c','from importlib.metadata import version; assert version("llm") == "0.27.1"'],{timeout:5000}).status===0;
test('native fragment bridge preserves registered loader calls, lists, Unicode and attachments',{skip:!available&&!process.env.LLM_TEST_PYTHON?'Requires pinned llm==0.27.1':false},()=>{
 const result=spawnSync(python,['-B','-c',String.raw`
import json,sys,llm,types,hashlib

from importlib.metadata import version
assert version('llm') == '0.27.1'
calls=[]
def fragment(value):
 calls.append(value)
 if value == 'empty': return []
 if value == 'single': return llm.Fragment('single\r\n界', 'fixture')
 if value == 'error': raise ValueError('native failure')
 return [llm.Fragment('head\r\n界', 'fixture'),llm.Attachment(content=b'\x00\xff',type='application/octet-stream'),llm.Fragment('tail', 'fixture')]
class Plugin:
 @llm.hookimpl
 def register_fragment_loaders(self,register):
  register('native',fragment)
llm.plugins.load_plugins()
llm.plugins.pm.register(Plugin(),name='fragment-fixture')
program=json.load(sys.stdin)
for value in ('empty','single','multiple','error'):
 messages=[]
 def call(capability,message):
  assert capability == 'llm_fragments'
  if message['op'] == 'request': return dict(prefix='native',value=value,plugins=[])
  messages.append(message)
  return True
 sys.modules['safe_host']=types.SimpleNamespace(call=call)
 sys.modules['llm_safe_host']=types.SimpleNamespace(_attachment_type=lambda attachment:attachment.type)
 exec(program,{})
 if value == 'empty': assert messages == []
 elif value == 'error': assert messages == [dict(op='error',message='native failure')]
 else:
  fragments=[]
  for message in messages:
   if message['op']=='begin': fragments.append(dict(metadata=message,data=b''))
   elif message['op']=='text': fragments[-1]['data']+=message['text'].encode()
   elif message['op']=='bytes': fragments[-1]['data']+=bytes(message['bytes'])
   else: assert message['op']=='end',message
  if value=='single': assert fragments[0]['data']=='single\r\n界'.encode()
  else:
   assert [f['data'] for f in fragments]==['head\r\n界'.encode(),b'\x00\xff',b'tail']
   assert fragments[1]['metadata']['id']==hashlib.sha256(b'\x00\xff').hexdigest()
assert calls == ['empty','single','multiple','error']
# File fixtures are entirely in memory. The bridge must hash and read the same
# handle with bounded windows, including native empty-content precedence.
import io,builtins
payload=bytes(range(256))*100
opened=[]
class Handle(io.BytesIO):
 def read(self,size=-1):
  assert 0 <= size <= 4096
  return super().read(size)
def open_fixture(path,mode):
 assert path == 'fixture.bin' and mode == 'rb'
 handle=Handle(payload);opened.append(handle);return handle
attachments=[llm.Attachment(path='fixture.bin',type='application/octet-stream'),
 llm.Attachment(content=b'',type='application/octet-stream'),
 llm.Attachment(url='https://fixture.test/data',type='text/plain'),
 llm.Attachment(content=b'custom',type='text/plain',_id='custom-id')]
expected=[hashlib.sha256(payload).hexdigest(),attachments[1].id(),attachments[2].id(),'custom-id']
llm.get_fragment_loaders=lambda:{'native':lambda value:attachments}
messages=[]
def call(capability,message):
 if message['op']=='request': return dict(prefix='native',value='',plugins=[])
 messages.append(message);return True
sys.modules['safe_host']=types.SimpleNamespace(call=call)
exec(program,dict(open=open_fixture))
assert [m['id'] for m in messages if m['op']=='begin']==expected
assert len(opened)==1 and opened[0].closed
assert all(len(m['bytes'])<=4096 for m in messages if m['op']=='bytes')
assert b''.join(bytes(m['bytes']) for m in messages if m['op']=='bytes')==payload+b'custom'
assert next(m for m in messages if m.get('url'))['url']=='https://fixture.test/data'
# Advancing is explicit: an early return never serializes the next result.
messages=[]
def stop(capability,message):
 if message['op']=='request': return dict(prefix='native',value='',plugins=[])
 messages.append(message);return False
sys.modules['safe_host']=types.SimpleNamespace(call=stop)
exec(program,dict(open=open_fixture))
assert len([m for m in messages if m['op']=='begin'])==1
assert opened[-1].closed


`],{input:JSON.stringify(pythonLlmFragmentProgram),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
