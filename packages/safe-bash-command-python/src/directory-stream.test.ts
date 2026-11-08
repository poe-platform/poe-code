import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {pythonStatProjection} from './runtime-scripts.js';

test('Python scandir constructs entries on demand and retires cursors on close, EOF and errors',()=>{
 const result=spawnSync(process.env.LLM_TEST_PYTHON??'python3',['-B','-c',String.raw`
import json,sys,os,gc
program=json.load(sys.stdin)
opened=closed=0;handles={}
def cursor(operation,value):
 global opened,closed
 if operation=='directoryOpen':
  if value=='/missing':return json.dumps({'errno':2})
  opened+=1;handles[opened]=iter(range(4096) if value!='/empty' else ());return json.dumps({'value':opened})
 if operation=='directoryNext':
  return json.dumps({'value':next(handles[value],None)})
 if operation=='close':
  closed+=1;del handles[value];return json.dumps({})
 raise AssertionError(operation)
def callback(operation,value):
 result=json.loads(cursor(operation,value))
 if operation=='directoryNext' and result.get('value') is not None:result['value']='entry-'+str(result['value'])
 return json.dumps(result)
namespace={'_safe_stat_projection':None,'_safe_directory_cursor':callback,'_safe_runtime_mount':'/runtime'}
exec(program,namespace)
def forbidden(*args):raise AssertionError('scandir buffered the complete directory')
os.listdir=forbidden
for path in ['/data',b'/data']:
 with os.scandir(path) as entries:
  first=next(entries);second=next(entries)
  assert first.name==('entry-0' if isinstance(path,str) else b'entry-0')
  assert second.path==os.path.join(path,'entry-1' if isinstance(path,str) else b'entry-1')
 assert list(entries)==[]
assert opened==closed==2 and not handles
with os.scandir('/empty') as entries:assert list(entries)==[]
assert opened==closed==3
for missing in ['/missing',b'/missing','',b'']:
 try:os.scandir(missing)
 except FileNotFoundError as error:assert error.filename==missing
 else:raise AssertionError('missing path did not fail at acquisition')
entries=os.scandir('/data');del entries;gc.collect()
assert opened==closed==4
try:
 with os.scandir('/data') as entries:raise RuntimeError('user error')
except RuntimeError:pass
assert opened==closed==5
`],{input:JSON.stringify(pythonStatProjection),encoding:'utf8',timeout:5000});
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
});
