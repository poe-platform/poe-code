/** Executed unchanged by PythonSession and the pinned external oracle. */
export const codecCallSlotCases = [
  ...["CodecInfo", "IncrementalEncoder", "IncrementalDecoder", "BufferedIncrementalEncoder", "BufferedIncrementalDecoder", "StreamReader", "StreamWriter", "StreamReaderWriter", "StreamRecoder"].map(base => ({name: `${base} readiness and query identity`, source: `
import codecs
seen = []
expected = '__call__'
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other is expected)
        return str.__eq__(self, other)
key = Key(expected)
namespace = {key: lambda self, value: value}
C = type('C', (codecs.${base},), namespace)
assert seen == [True], seen
assert next(iter(namespace)) is key
assert next(key for key in C.__dict__ if key == expected) is key
`})),
  {name: "call readiness follows hash and precedes str", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__hash__'): lambda self: 7, Key('__call__'): lambda self: 19, Key('__str__'): lambda self: 'decoder'})
assert seen == ['__hash__'] * 4 + ['__call__', '__str__'], seen
value = C()
seen.clear()
assert callable(value)
assert seen == [], seen
assert value() == 19
assert seen == ['__call__'], seen
`},
  {name: "failed call fixup disables invocation but preserves the dictionary", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 1:
                raise ValueError('call fixup')
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__call__'): lambda self: 23})
assert seen == ['__call__'], seen
value = C()
assert not callable(value)
try:
    value()
except TypeError as error:
    assert error.args == ("'C' object is not callable",), error.args
else:
    assert False
assert seen == ['__call__'], seen
assert C.__call__(value) == 23
C.__call__ = lambda self: 29
assert callable(value)
assert value() == 29
`},
  {name: "descriptor binding is deferred to invocation", source: `
import codecs
seen = []
class Descriptor:
    def __get__(self, instance, owner):
        seen.append((instance, owner))
        return lambda *args, **kwargs: (args, kwargs)
descriptor = Descriptor()
class C(codecs.IncrementalDecoder):
    __call__ = descriptor
value = C()
assert callable(value)
assert seen == []
assert value(1, named=2) == ((1,), {'named': 2})
assert seen == [(value, C)]
assert C.__dict__['__call__'] is descriptor
`},
  {name: "inherited mutation and disabled call values", source: `
import codecs
class Base(codecs.IncrementalDecoder):
    def __call__(self):
        return 31
class Child(Base):
    pass
value = Child()
assert value() == 31
Base.__call__ = lambda self: 37
assert value() == 37
Base.__call__ = None
assert callable(value)
try:
    value()
except TypeError as error:
    assert error.args == ("'NoneType' object is not callable",), error.args
else:
    assert False
del Base.__call__
assert not callable(value)
Child.__call__ = lambda self: 41
Base.__call__ = lambda self: 43
assert value() == 41
del Child.__call__
assert value() == 43
`},
  {name: "source mutation leaves the copied call slot intact", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            namespace.clear()
            namespace['changed'] = 47
        return str.__eq__(self, other)
key = Key('__call__')
namespace = {key: lambda self: 53}
C = type('C', (codecs.IncrementalDecoder,), namespace)
assert seen == ['__call__'], seen
assert namespace == {'changed': 47}
assert 'changed' not in C.__dict__
assert C()() == 53
`},
  {name: "metaclass call fixup controls class callability", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 1:
                raise ValueError('metaclass call fixup')
        return str.__eq__(self, other)
Meta = type('Meta', (type,), {Key('__call__'): lambda cls: 67})
class C(codecs.IncrementalDecoder, metaclass=Meta):
    pass
assert seen == ['__call__'], seen
assert not callable(C)
try:
    C()
except TypeError as error:
    assert error.args == ("'Meta' object is not callable",), error.args
else:
    assert False
assert Meta.__call__(C) == 67
Meta.__call__ = type.__call__
assert callable(C)
assert type(C()) is C
`},
  {name: "supported service callback during call readiness", source: `
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
C = type('C', (codecs.IncrementalDecoder,), {Key('__call__'): lambda self: 59})
assert seen == ['__call__'], seen
assert C()() == 59
print('call slot ready', flush=True)
`}
] as const;
