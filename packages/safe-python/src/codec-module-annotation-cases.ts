/** Unchanged public programs for the pinned external oracle and interpreter. */
export const codecModuleAnnotationCases = [
  ...["codecs", "_codecs", "encodings", "encodings.aliases", "encodings.ascii", "encodings.latin_1", "encodings.utf_8", "encodings.charmap"].map(name => ({
    name: `${name} lazy annotation descriptors and cache invalidation`,
    source: `
import ${name} as module
assert '__annotations__' not in module.__dict__
assert '__annotate__' not in module.__dict__
annotations = module.__annotations__
assert type(annotations) is dict and annotations == {}
assert module.__annotations__ is annotations
assert module.__dict__['__annotations__'] is annotations
assert module.__annotate__ is None
assert module.__dict__['__annotate__'] is None
events = []
result = {'text': str}
def annotate(format):
    events.append(format)
    return result
module.__annotate__ = annotate
assert '__annotations__' not in module.__dict__
assert module.__annotations__ is result
assert module.__annotations__ is result and events == [1]
module.__annotate__ = None
assert module.__annotations__ is result
module.__annotate__ = annotate
assert '__annotations__' not in module.__dict__
module.__annotations__ = None
assert module.__annotations__ is None
assert '__annotate__' not in module.__dict__
for value in ([], 42, None):
    module.__annotations__ = value
    assert module.__annotations__ is value
del module.__annotations__
try:
    del module.__annotations__
except AttributeError as error:
    assert error.args == ('__annotations__',)
else:
    assert False
try:
    del module.__annotate__
except TypeError as error:
    assert error.args == ('cannot delete __annotate__ attribute',)
else:
    assert False
for value in (1, [], {}):
    try:
        module.__annotate__ = value
    except TypeError as error:
        assert error.args == ('__annotate__ must be callable or None',)
    else:
        assert False
module.__dict__['__annotate__'] = 1
assert module.__annotate__ == 1
assert module.__annotations__ == {}
`
  })),
  {
    name: "annotation callback subtype results, recursion, exceptions and retry",
    source: `
import codecs as module
events = []
class Result(dict):
    def __setitem__(self, key, value):
        raise AssertionError('virtual dict mutation')
result = Result(text=str)
failure = ValueError('annotation callback failed')
def annotate(format):
    events.append(format)
    if len(events) == 1:
        raise failure
    return result
module.__annotate__ = annotate
try:
    module.__annotations__
except ValueError as error:
    assert error is failure and error.args == ('annotation callback failed',)
else:
    assert False
assert '__annotations__' not in module.__dict__
assert module.__annotations__ is result and events == [1, 1]
for value in (None, [], 1):
    module.__annotate__ = lambda format: value
    try:
        module.__annotations__
    except TypeError as error:
        assert error.args == ("__annotate__ returned non-dict of type '" + type(value).__name__ + "'",)
    else:
        assert False
    assert '__annotations__' not in module.__dict__
def inner(format):
    events.append('inner')
    return result
def outer(format):
    events.append('outer')
    module.__annotate__ = inner
    assert module.__annotations__ is result
    return {'outer': True}
module.__annotate__ = outer
assert module.__annotations__ == {'outer': True}
assert events == [1, 1, 'outer', 'inner']
assert module.__annotate__ is inner
`
  },
  {
    name: "initializing module annotations, spec callbacks and cached precedence",
    source: `
import codecs
module = type(codecs)('annotation_probe')
events = []
failure = ValueError('spec failed')
class Flag:
    def __bool__(self):
        events.append('truth')
        return True
class Spec:
    @property
    def _initializing(self):
        events.append('spec')
        return Flag()
module.__spec__ = Spec()
def annotate(format):
    events.append(format)
    return {}
module.__annotate__ = annotate
first = module.__annotations__
assert first == {} and '__annotations__' not in module.__dict__
assert module.__annotations__ is not first
assert events == ['spec', 'truth', 1, 'spec', 'truth', 1]
class BadSpec:
    @property
    def _initializing(self):
        raise failure
module.__spec__ = BadSpec()
try:
    module.__annotations__
except ValueError as error:
    assert error is failure
else:
    assert False
module.__dict__['__annotations__'] = first
assert module.__annotations__ is first
`
  },
  {
    name: "module annotation descriptors honor overridden dictionaries",
    source: `
import codecs
Module = type(codecs)
namespace = {}
events = []
class M(Module):
    @property
    def __dict__(self):
        events.append('dict')
        return namespace
module = M('override')
assert module.__annotations__ is namespace['__annotations__']
assert events == ['dict']
namespace = None
try:
    module.__annotations__
except TypeError as error:
    assert error.args == ('<module>.__dict__ is not a dictionary',)
else:
    assert False
try:
    module.__annotate__ = 1
except TypeError as error:
    assert error.args == ('<module>.__dict__ is not a dictionary',)
else:
    assert False
try:
    del module.__annotate__
except TypeError as error:
    assert error.args == ('cannot delete __annotate__ attribute',)
else:
    assert False
for name in ('__annotations__', '__annotate__'):
    descriptor = Module.__dict__[name]
    assert type(descriptor).__name__ == 'getset_descriptor'
    assert descriptor.__name__ == name
    assert descriptor.__qualname__ == 'module.' + name
    assert descriptor.__objclass__ is Module and descriptor.__doc__ is None
`
  },
  {
    name: "annotation descriptors use captured dictionaries and native initialization specs",
    source: `
import codecs
Module = type(codecs)
namespace = {}
original = namespace
events = []
class M(Module):
    def __getattribute__(self, name):
        if name == '__dict__':
            events.append('dict')
            return namespace
        return Module.__getattribute__(self, name)
module = M('capture')
class Flag:
    def __bool__(self):
        events.append('truth')
        return True
class Spec:
    def __getattribute__(self, name):
        events.append(name)
        if name == '_initializing':
            return Flag()
        return object.__getattribute__(self, name)
module.__spec__ = Spec()
assert module.__annotations__ == {}
assert original == {}
assert events == ['dict', '_initializing', 'truth']
module.__spec__ = None
result = {}
def annotate(format):
    global namespace
    namespace = {}
    return result
module.__annotate__ = annotate
assert module.__annotations__ is result
assert original['__annotations__'] is result
assert namespace == {}
namespace = []
try:
    module.__annotations__
except TypeError as error:
    assert error.args == ('<module>.__dict__ is not a dictionary',)
else:
    assert False
for name in ('__annotations__', '__annotate__'):
    descriptor = Module.__dict__[name]
    assert type(descriptor).__name__ == 'getset_descriptor'
    assert descriptor.__name__ == name
    assert descriptor.__qualname__ == 'module.' + name
    assert descriptor.__objclass__ is Module and descriptor.__doc__ is None
`
  },
  {
    name: "module annotation callback uses the explicit input and output services",
    source: `
import codecs
def annotate(format):
    assert format == 1
    return {'text': input()}
codecs.__annotate__ = annotate
assert codecs.__annotations__ == {'text': 'annotation'}
assert codecs.__annotations__ == {'text': 'annotation'}
print('verified')
`
  }
] as const;
