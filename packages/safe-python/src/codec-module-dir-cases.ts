/** Public module programs shared unchanged with the CPython oracle. */
export const codecModuleDirCases = [
  {
    name: "directory descriptor metadata and bound argument diagnostics",
    source: `
import codecs
Module = type(codecs)
method = Module.__dir__
assert method.__name__ == '__dir__'
assert method.__qualname__ == 'module.__dir__'
assert method.__objclass__ is Module
assert method.__doc__ == '__dir__() -> list\\nspecialized dir() implementation'
assert method.__text_signature__ == '($self, /)'
for call, message in (
    (lambda: method(), 'unbound method module.__dir__() needs an argument'),
    (lambda: method(None), "descriptor '__dir__' for 'module' objects doesn't apply to a 'NoneType' object"),
    (lambda: method(codecs, 1), 'module.__dir__() takes no arguments (1 given)'),
    (lambda: method(codecs, x=1), 'module.__dir__() takes no keyword arguments'),
    (lambda: codecs.__dir__(1), '__dir__() takes no arguments (1 given)'),
    (lambda: codecs.__dir__(x=1), '__dir__() takes no keyword arguments'),
):
    try:
        call()
    except TypeError as error:
        assert error.args == (message,)
    else:
        assert False
print('verified')
`
  },
  {
    name: "visible dictionary and native dictionary subtype operations",
    source: `
import codecs
Module = type(codecs)
events = []
class Namespace(dict):
    def keys(self):
        raise AssertionError('virtual keys')
    def __getitem__(self, key):
        raise AssertionError('virtual lookup')
    def __iter__(self):
        raise AssertionError('virtual iteration')
namespace = Namespace(z=1, a=2)
class M(Module):
    @property
    def __dict__(self):
        events.append('dict')
        return namespace
module = M('probe')
module.hidden = True
assert Module.__dir__(module) == ['z', 'a']
assert dir(module) == ['a', 'z']
assert events == ['dict', 'dict']
result = ['z', 'a']
def custom():
    events.append('call')
    namespace.clear()
    return result
namespace['__dir__'] = custom
assert Module.__dir__(module) is result
assert events == ['dict', 'dict', 'dict', 'call']
assert namespace == {}
assert Module.__dir__(module) == []
print('verified')
`
  },
  {
    name: "dictionary validation and callback failure identity",
    source: `
import _codecs
Module = type(_codecs)
class M(Module):
    @property
    def __dict__(self):
        return namespace
module = M('probe')
for namespace in (None, [], 1):
    try:
        Module.__dir__(module)
    except TypeError as error:
        assert error.args == ('<module>.__dict__ is not a dictionary',)
    else:
        assert False
for callback in (None, 1):
    namespace = {'__dir__': callback}
    try:
        Module.__dir__(module)
    except TypeError as error:
        assert error.args == ("'" + type(callback).__name__ + "' object is not callable",)
    else:
        assert False
failure = ValueError('directory failed')
def callback():
    raise failure
namespace = {'__dir__': callback}
try:
    Module.__dir__(module)
except ValueError as error:
    assert error is failure
else:
    assert False
namespace = {'__dir__': lambda: None}
assert Module.__dir__(module) is None
print('verified')
`
  },
  {
    name: "overridden attribute lookup and dictionary errors",
    source: `
import encodings
Module = type(encodings)
events = []
failure = ValueError('dictionary failed')
class M(Module):
    def __getattribute__(self, name):
        events.append(name)
        if name == '__dict__':
            if broken:
                raise failure
            return {'visible': 1}
        return Module.__getattribute__(self, name)
module = M('probe')
broken = False
assert Module.__dir__(module) == ['visible']
broken = True
try:
    Module.__dir__(module)
except ValueError as error:
    assert error is failure
else:
    assert False
assert events == ['__dict__', '__dict__']
print('verified')
`
  },
  {
    name: "directory descriptor uses explicit input and output services",
    source: `
import codecs
Module = type(codecs)
class M(Module):
    @property
    def __dict__(self):
        return {input(): 1}
module = M('service')
assert Module.__dir__(module) == ['visible']
print('verified')
`
  }
] as const;
