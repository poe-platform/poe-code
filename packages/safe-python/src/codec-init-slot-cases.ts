export const codecInitSlotCases = [
  ...["CodecInfo", "IncrementalEncoder", "IncrementalDecoder", "BufferedIncrementalEncoder", "BufferedIncrementalDecoder", "StreamReader", "StreamWriter", "StreamReaderWriter", "StreamRecoder"].map(base => ({name: `${base} initialization query identity and source key`, source: `
import codecs
seen = []
expected = '__init__'
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other is expected)
        return str.__eq__(self, other)
key = Key(expected)
namespace = {key: None}
C = type('C', (codecs.${base},), namespace)
assert seen == [True], seen
assert next(iter(namespace)) is key
assert next(key for key in C.__dict__ if key == expected) is key
assert C.__init__ is None
`})),
  {name: "failed initialization fixup suppresses implicit initialization only", source: `
import codecs
seen = []
calls = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 1:
                raise ValueError('init fixup')
        return str.__eq__(self, other)
def initialize(self, value=1):
    calls.append(value)
C = type('C', (codecs.IncrementalDecoder,), {Key('__init__'): initialize})
assert seen == ['__init__'], seen
value = C(7)
assert calls == [], calls
assert C.__init__(value, 9) is None
assert calls == [9]
C.__init__ = initialize
C(11)
assert calls == [9, 11]
del C.__init__
assert C('replace').errors == 'replace'
`},
  {name: "initializer descriptor binds only on invocation", source: `
import codecs
seen = []
class Descriptor:
    def __get__(self, instance, owner):
        seen.append((instance, owner))
        def initialize(*args, **kwargs):
            seen.append((args, kwargs))
        return initialize
descriptor = Descriptor()
class C(codecs.IncrementalDecoder):
    __init__ = descriptor
assert seen == []
value = C(1, option=2)
assert seen == [(value, C), ((1,), {'option': 2})], seen
assert C.__dict__['__init__'] is descriptor
`},
  {name: "initializer mutation tracks descendants overrides and deletion", source: `
import codecs
seen = []
class Base(codecs.IncrementalDecoder):
    def __init__(self):
        seen.append(1)
class Child(Base):
    pass
Child()
Base.__init__ = lambda self: seen.append(2)
Child()
Child.__init__ = lambda self: seen.append(3)
Base.__init__ = lambda self: seen.append(4)
Child()
del Child.__init__
Child()
assert seen == [1, 2, 3, 4], seen
Base.__init__ = None
try:
    Child()
except TypeError as error:
    assert error.args == ("'NoneType' object is not callable",), error.args
else:
    assert False
Base.__init__ = object.__init__
Child()
`},
  {name: "copied initializer survives source mutation", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            namespace.clear()
        return str.__eq__(self, other)
key = Key('__init__')
namespace = {key: lambda self: setattr(self, 'ready', True)}
C = type('C', (codecs.IncrementalDecoder,), namespace)
assert seen == ['__init__'], seen
assert namespace == {}
assert C().ready is True
`},
  {name: "new return type selects initialization and validates return value", source: `
import codecs
seen = []
class Base(codecs.IncrementalDecoder):
    def __new__(cls, value):
        return object.__new__(Child) if value else 17
    def __init__(self, value):
        seen.append('base')
class Child(Base):
    def __init__(self, value):
        seen.append(value)
assert Base(False) == 17
assert type(Base(True)) is Child
assert seen == [True], seen
Child.__init__ = lambda self, value: 3
try:
    Base(True)
except TypeError as error:
    assert error.args == ("__init__() should return None, not 'int'",), error.args
else:
    assert False
`},
  {name: "initialization fixup precedes allocation fixup", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__init__'): None, Key('__new__'): None})
assert seen == ['__new__', '__init__', '__new__'], seen
`},
  {name: "published class inherits initialization between readiness probes", source: `
import codecs
seen = []
calls = []
cell = (lambda value: lambda: value)(None).__closure__[0]
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            value = cell.cell_contents()
            seen.append(len(calls))
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__hash__'): None, '__init__': lambda self: calls.append(1), '__classcell__': cell})
assert seen == [0, 1, 2, 3], seen
assert len(calls) == 3
`},
  {name: "supported service callback during initialization readiness", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 1:
                assert input() == 'ready'
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__init__'): lambda self: None})
assert seen == ['__init__'], seen
assert type(C()) is C
print('init slot ready', flush=True)
`}
] as const;
