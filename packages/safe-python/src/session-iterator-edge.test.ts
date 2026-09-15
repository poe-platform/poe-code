import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

it.each([
  ["live reverse list mutation", `
a=[1,2,3]
r=reversed(a)
assert next(r)==3
a.pop()
a[1]=9
assert list(r)==[9,1]
a.append(4)
assert next(r,'end')=='end'
`],
  ["reverse special method dispatch", `
class C:
 def __len__(self): return 2
 def __getitem__(self,i): return i+10
c=C()
c.__reversed__=lambda: 'instance'
assert list(reversed(c))==[11,10]
C.__reversed__=lambda self: 'class'
assert reversed(c)=='class'
C.__reversed__=None
try: reversed(c)
except TypeError as e: message=e.args[0]
assert message=="'C' object is not reversible"
`],
  ["reverse exhaustion after an item error", `
events=[]
class C:
 def __len__(self): return 3
 def __getitem__(self,i):
  events.append(i)
  raise ValueError('item')
r=reversed(C())
try: next(r)
except ValueError as e: assert e.args==('item',)
assert next(r,'end')=='end'
assert events==[2]
`],
  ["list base reversal versus override", `
class L(list):
 def __reversed__(self): return 'override'
 def __getitem__(self,i): raise ValueError('getitem')
 def __len__(self): raise ValueError('len')
a=L([1,2,3])
assert reversed(a)=='override'
assert list(list.__reversed__(a))==[3,2,1]
`],
  ["filter predicate stop payload and resumption", `
stop=StopIteration('predicate')
def predicate(x):
 if x==1: raise stop
 return True
r=filter(predicate,[1,2])
try: next(r)
except StopIteration as e: assert e is stop
assert next(r)==2
assert next(r,'end')=='end'
`],
  ["map callback stop payload and resumption", `
stop=StopIteration('mapper')
def mapper(x):
 if x==1: raise stop
 return x+10
r=map(mapper,[1,2],strict=True)
try: next(r)
except StopIteration as e: assert e is stop
assert next(r)==12
assert next(r,'end')=='end'
`],
  ["zip strict probe consumption", `
a=iter([1])
b=iter([2,3,4])
r=zip(a,b,strict=True)
assert next(r)==(1,2)
try: next(r)
except ValueError as e: assert e.args==('zip() argument 2 is longer than argument 1',)
assert next(b)==4
`],
  ["enumerate index conversion before iterator acquisition", `
events=[]
class Start:
 def __index__(self):
  events.append('index')
  return 1000000000000000000000000000000
class Items:
 def __iter__(self):
  events.append('iter')
  return iter([9])
r=enumerate(Items(),Start())
assert events==['index','iter']
assert next(r)==(1000000000000000000000000000000,9)
`]
])("matches CPython iterator behavior: %s", (_name, source) => {
  const s = new PythonSession({ limits: { maxSteps: 200_000, maxAllocatedBytes: 2_000_000, maxDepth: 100 }, hashSeed: [1n, 2n] });
  expect(s.exec(source).status).toBe("ok");
});
