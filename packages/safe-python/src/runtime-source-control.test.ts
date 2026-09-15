import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

const cases = [
  { name: "callback and assignment order", source: `events=[]
class Box:
 def __setitem__(self,key,value):events.append(('set',key,value))
 def __delitem__(self,key):events.append(('del',key))
def mark(x):
 events.append(x)
 return x
b=Box()
b[mark('key')]=mark('value')
del b[mark('delete')]
`, check: "events == ['value','key',('set','key','value'),'delete',('del','delete')]" },
  { name: "closure defaults and decorators", source: `events=[]
def deco(n):
 events.append(n)
 def apply(f):
  events.append(-n)
  return f
 return apply
def outer():
 x=3
 @deco(1)
 @deco(2)
 def f(a=x):return (a,x)
 x=4
 return f
f=outer()
`, check: "events == [1,2,-2,-1] and f() == (3,4)" },
  { name: "slots descriptors MRO and super", source: `events=[]
class Meta(type):
 def __new__(m,n,b,d):
  events.append(n)
  return super().__new__(m,n,b,d)
class A(metaclass=Meta):
 __slots__=('x',)
 def f(self):return ['A']
class B(A):
 __slots__=()
 def f(self):return ['B']+super().f()
b=B()
b.x=4
`, check: "events == ['A','B'] and b.f() == ['B','A'] and b.x == 4 and not hasattr(b,'__dict__')" },
  { name: "pattern guards retain captures", source: `events=[]
match [1,2,3]:
 case [a,*rest] if events.append(a):pass
 case [1,b,c]:events.append((b,c))
`, check: "events == [1,(2,3)] and a == 1 and rest == [2,3]" },
  { name: "exception chaining and cleanup", source: `events=[]
class CM:
 def __enter__(self):events.append('enter')
 def __exit__(self,t,v,tb):
  events.append((t.__name__,str(v)))
  return True
with CM():
 try:raise ValueError('first')
 except ValueError as first:raise TypeError('second') from first
 finally:events.append('finally')
`, check: "events == ['enter','finally',('TypeError','second')]" },
  { name: "yield delegation send throw and close", source: `events=[]
def child():
 try:
  x=yield 1
  events.append(x)
  try:yield 2
  except ValueError:yield 3
  return 4
 finally:events.append('child-finally')
def parent():
 try:events.append((yield from child()))
 finally:events.append('parent-finally')
g=parent()
a=next(g)
b=g.send(10)
c=g.throw(ValueError())
d=g.close()
`, check: "(a,b,c,d) == (1,2,3,None) and events == [10,'child-finally','parent-finally']" },
  { name: "coroutine and async context suspension", source: `events=[]
class Wait:
 def __await__(self):
  value=yield 'pause'
  return value
class CM:
 async def __aenter__(self):
  events.append('enter')
  return await Wait()
 async def __aexit__(self,t,v,tb):
  events.append(('exit',t))
  await Wait()
async def work():
 async with CM() as x:events.append(x)
 return 9
c=work()
a=c.send(None)
b=c.send(7)
try:c.send(None)
except StopIteration as e:result=e.value
`, check: "a == b == 'pause' and result == 9 and events == ['enter',7,('exit',None)]" },
  { name: "async generator close awaits cleanup", source: `events=[]
class Wait:
 def __await__(self):yield 'cleanup'
async def gen():
 try:yield 1
 finally:
  await Wait()
  events.append('closed')
g=gen()
op=g.__anext__()
try:op.send(None)
except StopIteration as e:first=e.value
op=g.aclose()
a=op.send(None)
try:op.send(None)
except StopIteration:pass
`, check: "first == 1 and a == 'cleanup' and events == ['closed']" },
] as const;

it.each(cases)("public source: $name", ({source,check}) => {
  const s=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n]});
  const result=s.exec(source);
  if(result.status==="exception"){s.globals.set("failure",result.exception);expect(s.eval("str(failure)")).toMatchObject({value:{primitive:"no exception expected"}});}
  expect(result.status).toBe("ok");
  expect(s.eval(check)).toMatchObject({status:"ok",value:{primitive:true}});
});

it("keeps fatal cancellation outside guest handlers and cleanup", () => {
  const controller=new AbortController(),output:string[]=[];
  const s=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,output:{write(text){output.push(text);controller.abort();},flush(){}}});
  expect(s.exec(`class CM:
 def __enter__(self):pass
 def __exit__(self,*args):print('exit');return True
def g():
 with CM():
  try:
   yield 1
   print('cancel')
  except BaseException:print('caught')
  finally:print('finally')
x=g()
next(x)
next(x)
`)).toMatchObject({status:"terminated",reason:"cancelled"});
  expect(output).toEqual(['cancel']);
  expect(s.exec("pass")).toMatchObject({status:"terminated",reason:"cancelled"});
});

it.each([
  ["super()", "RuntimeError", "super(): no arguments"],
  ["super(1)", "TypeError", "super() argument 1 must be a type, not int"],
  ["super(A,1)", "TypeError", "super(type, obj): obj (instance of int) is not an instance or subtype of type (A)."],
  ["super(A,str)", "TypeError", "super(type, obj): obj (type str) is not an instance or subtype of type (A)."],
  ["super(A,x=1)", "TypeError", "super() takes no keyword arguments"],
  ["super(A,A,1)", "TypeError", "super() expected at most 2 arguments, got 3"],
  ["super(A).__get__(None)", "TypeError", "__get__(None, None) is invalid"],
  ["super(A).__get__(None,None)", "TypeError", "__get__(None, None) is invalid"],
  ["A.noargs()", "RuntimeError", "super(): no arguments"],
  ["A().deleted()", "RuntimeError", "super(): arg[0] deleted"],
  ["outside(A())", "RuntimeError", "super(): __class__ cell not found"],
])("validates native super: %s", (expression,name,message) => {
  const s=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n]});
  expect(s.exec(`class A:
 def noargs():return super()
 def deleted(self):
  del self
  return super()
def outside(self):return super()
try:${expression}
except BaseException as e:result=(type(e).__name__,str(e))
else:result=None
`).status).toBe('ok');
  expect(s.eval(`result == (${JSON.stringify(name)},${JSON.stringify(message)})`)).toMatchObject({status:'ok',value:{primitive:true}});
});

it("binds super descriptors, including class-bound and reported __class__ receivers", () => {
  const s=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n]});
  expect(s.exec(`events=[]
class Descriptor:
 def __get__(self,obj,owner):
  events.append((obj,owner))
  return 17
class A:
 value=Descriptor()
 @classmethod
 def method(cls):return cls
class B(A):pass
b=B()
u=super(B)
v=u.__get__(b,B)
a=v.value
c=super(B,B).value
class Proxy:
 __class__=B
p=Proxy()
w=super(B,p)
d=w.value
fresh=super.__new__(super)
`).status).toBe('ok');
  expect(s.eval("a == c == d == 17 and events == [(b,B),(None,B),(p,B)] and v.__self__ is b and v.__thisclass__ is B and v.__self_class__ is B and v.__class__ is super and super(B,B).method() is B and u.__self__ is None and fresh.__thisclass__ is fresh.__self__ is fresh.__self_class__ is None")).toMatchObject({status:'ok',value:{primitive:true}});
});

it("publishes super documentation and read-only member descriptors", () => {
  const s=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n]});
  expect(s.exec(`class A:pass
s=super(A)
errors=[]
for name in ('__thisclass__','__self__','__self_class__'):
 try:setattr(s,name,None)
 except AttributeError as e:errors.append(str(e))
 try:delattr(s,name)
 except AttributeError as e:errors.append(str(e))
`).status).toBe('ok');
  expect(s.eval("errors == ['readonly attribute']*6 and super.__doc__.startswith('super() -> same as super(__class__, <first argument>)') and super.__thisclass__.__doc__ == 'the class invoking super()'")).toMatchObject({status:'ok',value:{primitive:true}});
});

it("retains super initialization state on failure and rebinds subclass descriptors", () => {
  const s=new PythonSession({limits:{maxSteps:2_000_000,maxAllocatedBytes:16_000_000,maxDepth:100},hashSeed:[1n,2n]});
  expect(s.exec(`events=[]
class A:
 def f(self):return 'A'
class B(A):
 def f(self):
  def capture():return self
  return super().f(),capture() is self
class S(super):
 def __init__(self,*args):
  events.append(args)
  super().__init__(*args)
b=B()
s=S(B)
t=s.__get__(b,B)
r=t.f()
try:super.__init__(t,B,1)
except TypeError:pass
`).status).toBe('ok');
  expect(s.eval("r == 'A' and b.f() == ('A',True) and type(t) is S and t.__self__ is b and events == [(B,),(B,b)] and t.__get__(A(),A) is t")).toMatchObject({status:'ok',value:{primitive:true}});
});
