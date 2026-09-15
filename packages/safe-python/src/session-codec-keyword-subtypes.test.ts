import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

it.each(["encode","decode"])("keeps cancellation fatal during %s keyword diagnostics",operation=>{
  for(const stage of ["equality","truth","render"]){
    const controller=new AbortController(),writes:string[]=[];
    const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:4000000,maxDepth:100},hashSeed:[1n,2n],signal:controller.signal,
      output:{write(text){writes.push(text);controller.abort();},flush(){}}
    });
    const result=session.exec(`
class Truth:
    def __bool__(self):
        ${stage==="truth"?"print('cancel')":"pass"}
        return False
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        ${stage==="equality"?"print('cancel')":"pass"}
        return Truth()
    def __str__(self):
        ${stage==="render"?"print('cancel')":"pass"}
        return 'visible'
try:
    ${operation==="encode"?"'x'.encode":"b'x'.decode"}(**{Key('encodign'): 'ascii'})
except BaseException:
    print('recovered')
`);
    expect(writes).toEqual(["cancel"]);
    expect(result).toMatchObject({status:"terminated",reason:"cancelled"});
    expect(session.eval("1")).toMatchObject({status:"terminated",reason:"cancelled"});
  }
});

it.each(["encode","decode"])("%s binds string-subtype keyword names without virtual methods",operation=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:4000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(`
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        raise AssertionError('keyword equality')
    def __str__(self):
        raise AssertionError('keyword string')
convert = ${operation==="encode"?"'é'.encode":"b'\\xe9'.decode"}
assert convert(**{Key('encoding'): 'latin1', Key('errors'): 'strict'}) == ${operation==="encode"?"b'\\xe9'":"'é'"}
try:
    convert('ascii', **{Key('encoding'): 'latin1'})
except TypeError as error:
    assert error.args == ("argument for ${operation}() given by name ('encoding') and position (1)",)
else:
    assert False
`);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const diagnostic=session.eval("str(failure)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});

it.each(["encode","decode"])("%s preserves unexpected-keyword comparison, rendering and failure order",operation=>{
  const session=new PythonSession({limits:{maxSteps:500000,maxAllocatedBytes:8000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(`
events = []
mode = 'false'
failure = ValueError('keyword failed')
class Truth:
    def __bool__(self):
        events.append('truth')
        return mode == 'true'
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        events.append(other)
        if mode == 'raise':
            raise failure
        return Truth()
    def __str__(self):
        events.append('str')
        if mode == 'render-failure':
            raise failure
        return 'visible'
convert = ${operation==="encode"?"'x'.encode":"b'x'.decode"}
for mode, expected in [
    ('false', ['encoding', 'truth', 'errors', 'truth', 'str']),
    ('true', ['encoding', 'truth']),
    ('raise', ['encoding']),
    ('render-failure', ['encoding', 'truth', 'errors', 'truth', 'str'])
]:
    events.clear()
    try:
        convert(**{Key('encodign'): 'ascii'})
    except ValueError as error:
        assert mode in ('raise', 'render-failure')
        assert error is failure
    except TypeError as error:
        if mode == 'true':
            assert error.args == ('invalid keyword argument for ${operation}()',)
        else:
            assert mode == 'false'
            assert error.args == ("${operation}() got an unexpected keyword argument 'visible'. Did you mean 'encoding'?",)
    else:
        assert False
    assert events == expected, events
mode = 'false'
events.clear()
try:
    convert(**{Key('encoding'): 'ascii', Key('encodign'): 'ignore'})
except TypeError as error:
    assert error.args == ("${operation}() got an unexpected keyword argument 'visible'",)
else:
    assert False
assert events == ['encoding', 'truth', 'errors', 'truth', 'str']
`);
  let detail:string|undefined;
  if(result.status==="exception"){
    session.globals.set("failure",result.exception);
    const diagnostic=session.eval("str(failure)");
    if(diagnostic.status==="ok")detail=String(diagnostic.value.primitive);
  }
  expect(result.status,detail).toBe("ok");
});
