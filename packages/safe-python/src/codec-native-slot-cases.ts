export const codecNativeSlotCases = [
  {name: "type mutation retains the previous value before slot invalidation", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__hash__'): lambda self: 1})
seen.clear()
C.__hash__ = lambda self: 2
assert seen == ['__hash__'] * 3, seen
assert hash(C()) == 2
seen.clear()
del C.__hash__
assert seen == ['__hash__'] * 2, seen
`},
  {name: "repr slot is initialized during native class readiness", source: `
import codecs
seen = []
expected = '__repr__'
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other is expected)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key(expected): lambda self: 'decoder'})
assert seen == [True], seen
assert repr(C()) == 'decoder'
`},
  {name: "source mutation retains the copied namespace and original key", source: `
import codecs
expected = '__hash__'
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other is expected)
            namespace.clear()
            namespace['after_copy'] = 91
        return str.__eq__(self, other)
key = Key(expected)
namespace = {key: lambda self: 37}
C = type('C', (codecs.IncrementalDecoder,), namespace)
assert seen == [True] * 4
assert namespace == {'after_copy': 91}
assert next(key for key in C.__dict__ if key == expected) is key
assert hash(C()) == 37
assert 'after_copy' not in C.__dict__
`},
  {name: "real service callback observes initialization and invocation", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 4:
                assert input() == 'ready'
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__hash__'): lambda self: 43})
assert len(seen) == 4
assert hash(C()) == 43
print('native slot ready')
`},
  {name: "comparison fixup retains the inherited native comparison family", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 4:
                raise ValueError('comparison fixup')
        return str.__eq__(self, other)
C = type('C', (codecs.CodecInfo,), {Key('__eq__'): None})
assert len(seen) == 4
assert C(None, None) == C(None, None)
assert C.__eq__ is None
`},
  ...["CodecInfo", "IncrementalEncoder", "IncrementalDecoder", "BufferedIncrementalEncoder", "BufferedIncrementalDecoder", "StreamReader", "StreamWriter", "StreamReaderWriter", "StreamRecoder"].flatMap(base =>
    ["__eq__", "__hash__", "__new__", "__doc__"].map(name => ({name: `${base} ${name} inheritance probes`, source: `
import codecs
base = codecs.${base}
expected = '${name}'
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other is expected)
        return str.__eq__(self, other)
key = Key(expected)
namespace = {key: None}
C = type('C', (base,), namespace)
count = ${name === "__eq__" ? "len(base.__mro__) + 1" : name === "__hash__" ? "len(base.__mro__) + 2" : "2"}
assert seen == [True] * count, seen
assert next(iter(namespace)) is key
assert C.__bases__ == (base,)
assert C.__mro__ == (C,) + base.__mro__
assert next(key for key in C.__dict__ if key == expected) is key
`}))),
  ...[1, 2, 3].map(stage => ({name: `hash inheritance failure ${stage}`, source: `
import codecs
seen = []
failure = ValueError('inheritance')
cell = (lambda value: lambda: value)(None).__closure__[0]
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == ${stage}:
                raise failure
        return str.__eq__(self, other)
try:
    C = type('C', (codecs.IncrementalDecoder,), {Key('__hash__'): None, '__classcell__': cell})
except ValueError as caught:
    assert caught is failure
    assert caught.args == ('inheritance',)
    assert len(seen) == ${stage}
    assert cell.cell_contents.__name__ == 'C'
    assert 'C' not in globals()
    assert caught.__traceback__.tb_frame.f_code.co_name == '<module>'
    assert caught.__traceback__.tb_next.tb_frame.f_code.co_name == '__eq__'
    assert caught.__traceback__.tb_next.tb_next is None
else:
    assert False
assert len(seen) == ${stage}
assert cell.cell_contents.__name__ == 'C'
assert 'C' not in globals()
`})),
  {name: "new fixup failure disables allocation", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 2:
                raise ValueError('new fixup')
        return str.__eq__(self, other)
def allocate(cls):
    return object.__new__(cls)
C = type('C', (codecs.IncrementalDecoder,), {Key('__new__'): staticmethod(allocate)})
assert len(seen) == 2
try:
    C()
except TypeError as caught:
    assert str(caught) == "cannot create 'C' instances"
else:
    assert False
try:
    C.__new__(C)
except TypeError as caught:
    assert str(caught) == "cannot create 'C' instances"
else:
    assert False
C.__new__ = staticmethod(allocate)
assert type(C()) is C
`},
  {name: "published class uses inherited allocator before slot fixup", source: `
import codecs
cell = (lambda value: lambda: value)(None).__closure__[0]
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append('doc')
            if len(seen) == 2:
                C = cell.cell_contents
                seen.append(type(C()).__name__)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__doc__'): 'doc', '__classcell__': cell, '__new__': lambda cls: 17})
assert seen == ['doc', 'doc', 'C'], seen
assert C() == 17
`},
  {name: "ordered intrinsic probes", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
        return str.__eq__(self, other)
namespace = {Key('__doc__'): 'doc', Key('__eq__'): None, Key('__hash__'): None, Key('__new__'): None}
C = type('C', (codecs.IncrementalDecoder,), namespace)
assert seen == ['__doc__', '__new__', '__doc__', '__eq__', '__eq__', '__hash__', '__hash__', '__eq__', '__new__'], seen
assert C.__doc__ == 'doc'
assert C.__hash__ is None
assert C.__new__ is None
assert all(type(key) is Key for key in namespace)
`},
  {name: "hash fixup failure clears the native slot", source: `
import codecs
seen = []
failure = ValueError('fixup')
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 4:
                raise failure
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__hash__'): lambda self: 41})
assert len(seen) == 4, seen
value = C()
try:
    hash(value)
except TypeError as caught:
    assert str(caught) == "unhashable type: 'C'"
else:
    assert False, 'missing native hash slot was ignored'
assert C.__hash__(value) == 41
C.__hash__ = lambda self: 42
assert hash(value) == 42
`},
  {name: "inherited hash mutation", source: `
import codecs
class Base(codecs.IncrementalDecoder):
    def __hash__(self):
        return 11
class Child(Base):
    pass
value = Child()
assert hash(value) == 11
Base.__hash__ = lambda self: 12
assert hash(value) == 12
Base.__hash__ = None
try:
    hash(value)
except TypeError:
    pass
else:
    assert False
del Base.__hash__
assert hash(value) == object.__hash__(value)
`}
] as const;

export const codecNativeSlotCancellationCases = [
  ...[1, 2, 3].map(stage => ({name: "__eq__", stage})),
  ...[1, 2, 3, 4].map(stage => ({name: "__hash__", stage})),
  ...[1, 2].map(stage => ({name: "__new__", stage}))
].map(({name, stage}) => ({name, stage, source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == ${stage}:
                input()
        return str.__eq__(self, other)
try:
    C = type('C', (codecs.IncrementalDecoder,), {Key('${name}'): None})
except BaseException:
    raise AssertionError('fatal cancellation entered guest handling')
raise AssertionError('fatal cancellation was lost')
`}));
