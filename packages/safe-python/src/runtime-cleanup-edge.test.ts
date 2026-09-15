import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

const cases = [
  {name:"delegate close StopIteration completes delegation",source:`events=[]
class Delegate:
 def __iter__(self):return self
 def __next__(self):return 1
 def close(self):raise StopIteration(9)
def g():
 try:
  value=yield from Delegate()
  events.append(('continued',value))
 finally:events.append('finally')
x=g()
next(x)
try:x.close()
except RuntimeError as e:result=(str(e),type(e.__cause__).__name__,e.__cause__.value)
else:result=None
`,check:"result is None and events == [('continued',9),'finally']"},
  {name:"failed with target exits only entered managers",source:`events=[]
class CM:
 def __init__(self,n):self.n=n
 def __enter__(self):events.append(('enter',self.n));return ()
 def __exit__(self,t,v,tb):events.append(('exit',self.n,t.__name__ if t else None));return True
with CM(1) as (x,), CM(2):events.append('body')
`,check:"events == [('enter',1),('exit',1,'ValueError')]"},
  {name:"finally overrides pending loop transfers",source:`events=[]
for i in range(3):
 try:break
 finally:
  events.append(i)
  continue
else:events.append('else')
`,check:"events == [0,1,2,'else']"},
  {name:"generator close returns finalizer value once",source:`def g():
 try:yield 1
 finally:return 42
x=g()
a=next(x)
b=x.close()
c=x.close()
`,check:"(a,b,c) == (1,42,None)"},
  {name:"ignored generator close retains suspension",source:`events=[]
def g():
 try:yield 1
 except GeneratorExit:yield 2
 finally:events.append('cleanup')
x=g()
next(x)
try:x.close()
except RuntimeError as e:message=str(e)
x.close()
`,check:"message == 'generator ignored GeneratorExit' and events == ['cleanup']"},
  {name:"exception handler survives yield and deletes alias",source:`events=[]
def g():
 try:raise ValueError('original')
 except ValueError as e:
  yield str(e)
  try:raise
  except ValueError as nested:events.append(nested is e)
 try:e
 except UnboundLocalError:events.append('deleted')
x=g()
a=next(x)
b=next(x,None)
`,check:"a == 'original' and b is None and events == [True,'deleted']"},
  {name:"with suppression resumes pending return",source:`events=[]
class CM:
 def __enter__(self):return self
 def __exit__(self,t,v,tb):events.append(t);return True
def g():
 try:return 7
 finally:
  with CM():raise ValueError()
result=g()
`,check:"result == 7 and events == [ValueError]"},
  {name:"delegation returns child value after throw",source:`def child():
 try:yield 1
 except ValueError:return 8
def parent():
 result=yield from child()
 yield result
x=parent()
a=next(x)
b=x.throw(ValueError())
c=next(x,None)
`,check:"(a,b,c) == (1,8,None)"},
  {name:"exception cleanup replaces context with exit failure",source:`class CM:
 def __enter__(self):pass
 def __exit__(self,*args):raise TypeError('exit')
try:
 with CM():raise ValueError('body')
except TypeError as e:result=(str(e),type(e.__context__).__name__,str(e.__context__))
`,check:"result == ('exit','ValueError','body')"},
] as const;

it.each(cases)("public cleanup edge: $name",({source,check})=>{
 const session=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n]});
 expect(session.exec(source)).toMatchObject({status:"ok"});
 expect(session.eval(check)).toMatchObject({status:"ok",value:{primitive:true}});
});

it.each([
 {name:"coroutine async exit",source:`class CM:
 async def __aenter__(self):return self
 async def __aexit__(self,*args):
  try:print('cancel')
  except BaseException:print('exit-caught')
  finally:print('exit-finally')
  return True
async def work():
 try:
  async with CM():pass
 except BaseException:print('caught')
 finally:print('finally')
c=work()
c.send(None)
`},
 {name:"async generator awaited cleanup",source:`class Wait:
 def __await__(self):
  print('cancel')
  yield None
async def work():
 try:yield 1
 finally:
  try:await Wait()
  except BaseException:print('caught')
  finally:print('finally')
g=work()
op=g.__anext__()
try:op.send(None)
except StopIteration:pass
op=g.aclose()
op.send(None)
`},
])("fatal cancellation during $name",({source})=>{
 const controller=new AbortController(),output:string[]=[];
 const session=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,output:{write(text){output.push(text);controller.abort();},flush(){}}});
 expect(session.exec(source)).toMatchObject({status:"terminated",reason:"cancelled"});
 expect(output).toEqual(["cancel"]);
 expect(session.exec("print('resumed')")).toMatchObject({status:"terminated",reason:"cancelled"});
 expect(output).toEqual(["cancel"]);
});
