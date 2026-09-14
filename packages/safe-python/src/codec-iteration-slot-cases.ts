/** Unchanged public programs for the pinned external oracle and PythonSession. */
export const codecIterationSlotCases = [
  ...["CodecInfo", "IncrementalEncoder", "IncrementalDecoder", "BufferedIncrementalEncoder", "BufferedIncrementalDecoder", "StreamReader", "StreamWriter", "StreamReaderWriter", "StreamRecoder"].flatMap(base => ["__iter__", "__next__"].map(method => ({
    name: `${base} ${method} readiness query`,
    source: `import codecs
seen = []
expected = '${method}'
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
assert getattr(C, expected) is None
`
  }))),
  ...["__iter__", "__next__"].map(method => ({
    name: `${method} failed fixup and repair`,
    source: `import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 1:
                raise ValueError('iteration fixup')
        return str.__eq__(self, other)
def method(self):
    return ${method === "__iter__" ? "iter([7])" : "7"}
C = type('C', (codecs.IncrementalDecoder,), {Key('${method}'): method})
assert seen == ['${method}'], seen
value = C()
try:
    ${method === "__iter__" ? "iter(value)" : "next(value)"}
except TypeError as error:
    assert error.args == ("'C' object is not ${method === "__iter__" ? "iterable" : "an iterator"}",), error.args
else:
    raise AssertionError('failed slot remained callable')
assert ${method === "__iter__" ? "list(C.__iter__(value)) == [7]" : "C.__next__(value) == 7"}
setattr(C, '${method}', method)
assert ${method === "__iter__" ? "list(value) == [7]" : "next(value) == 7"}
`
  })),
  {name: "iteration mutation descendants and descriptor binding", source: `import codecs
events = []
class Descriptor:
    def __get__(self, instance, owner):
        events.append((instance, owner))
        return lambda: iter([1, 2])
class Base(codecs.IncrementalDecoder):
    __iter__ = Descriptor()
class Child(Base):
    pass
value = Child()
assert events == []
assert list(value) == [1, 2]
assert events == [(value, Child)], events
Base.__iter__ = lambda self: iter([3])
assert list(value) == [3]
Child.__iter__ = lambda self: iter([4])
Base.__iter__ = None
assert list(value) == [4]
del Child.__iter__
try:
    iter(value)
except TypeError as error:
    assert error.args == ("'Child' object is not iterable",), error.args
else:
    assert False
del Base.__iter__
Base.__getitem__ = lambda self, index: [5][index]
assert list(value) == [5]
`},
  {name: "next slot does not bind during iterator eligibility", source: `import codecs
events = []
class Descriptor:
    def __get__(self, instance, owner):
        events.append((instance, owner))
        return lambda: 9
class C(codecs.IncrementalDecoder):
    def __iter__(self):
        return self
    __next__ = Descriptor()
value = C()
assert iter(value) is value
assert events == []
assert next(value) == 9
assert events == [(value, C)], events
C.__next__ = None
assert iter(value) is value
try:
    next(value)
except TypeError as error:
    assert error.args == ("'NoneType' object is not callable",), error.args
else:
    assert False
del C.__next__
try:
    iter(value)
except TypeError as error:
    assert error.args == ("iter() returned non-iterator of type 'C'",), error.args
else:
    assert False
`},
  ...["__iter__", "__next__"].map(method => ({name: `${method} published class inheritance`, source: `import codecs
seen = []
cell = (lambda value: lambda: value)(None).__closure__[0]
class Base(codecs.IncrementalDecoder):
    def __iter__(self):
        return iter([8])
    def __next__(self):
        return 8
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            value = object.__new__(cell.cell_contents)
            try:
                seen.append(${method === "__iter__" ? "list(iter(value))" : "next(value)"})
            except TypeError as error:
                seen.append(error.args)
        return str.__eq__(self, other)
C = type('C', (Base,), {Key('__hash__'): None, '__classcell__': cell})
print(seen)
`})),
  {name: "native tuple iterator restoration and legacy fallback", source: `import codecs
class C(codecs.CodecInfo):
    __iter__ = lambda self: iter([7])
value = C(None, None)
assert list(value) == [7]
C.__iter__ = tuple.__iter__
assert list(value) == [None, None, None, None]
del C.__iter__
assert list(value) == [None, None, None, None]
`},
  {name: "iteration initialization query order", source: `import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__next__'): None, Key('__init__'): None, Key('__iter__'): None})
assert seen == ['__iter__', '__next__', '__init__'], seen
`},
  ...["__iter__", "__next__"].map(method => ({name: `${method} readiness serviced callback`, source: `import codecs
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            assert input() == 'ready'
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('${method}'): None})
print('ready')
`}))
];
