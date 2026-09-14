export const codecReprSlotCases = [
  {name: "readiness fixes repr before hash", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__repr__'): lambda self: 'decoder', Key('__hash__'): lambda self: 7})
assert seen == ['__hash__'] * 3 + ['__repr__', '__hash__'], seen
assert repr(C()) == 'decoder'
assert hash(C()) == 7
`},
  {name: "failed readiness clears repr without removing the explicit method", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 1:
                raise ValueError('fixup')
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__repr__'): lambda self: 'decoder'})
assert seen == ['__repr__'], seen
value = C()
assert repr(value) == '<C object at ' + hex(id(value)) + '>'
assert seen == ['__repr__'], seen
assert C.__repr__(value) == 'decoder'
C.__repr__ = lambda self: 'recovered'
assert repr(value) == 'recovered'
`},
  {name: "repr descriptors bind at invocation and preserve result identity", source: `
import codecs
seen = []
class Text(str):
    pass
result = Text('decoder')
class Descriptor:
    def __get__(self, instance, owner):
        seen.append((instance, owner))
        return lambda: result
class C(codecs.IncrementalDecoder):
    __repr__ = Descriptor()
assert seen == []
value = C()
assert repr(value) is result
assert seen == [(value, C)]
C.__repr__ = None
try:
    repr(value)
except TypeError as failure:
    assert str(failure) == "'NoneType' object is not callable"
else:
    assert False
C.__repr__ = lambda self: 17
try:
    repr(value)
except TypeError as failure:
    assert str(failure) == '__repr__ returned non-string (type int)'
else:
    assert False
`},
  {name: "repr mutation updates descendants and preserves overrides", source: `
import codecs
class Base(codecs.IncrementalDecoder):
    def __repr__(self):
        return 'first'
class Left(Base):
    pass
class Right(Base):
    pass
class Child(Left, Right):
    pass
class Override(Child):
    def __repr__(self):
        return 'own'
value = Child()
own = Override()
assert repr(value) == 'first'
Base.__repr__ = lambda self: 'second'
assert repr(value) == 'second'
assert repr(own) == 'own'
del Base.__repr__
assert repr(value) == object.__repr__(value)
assert repr(own) == 'own'
Child.__repr__ = object.__repr__
assert repr(value) == object.__repr__(value)
`},
  {name: "real service in repr readiness", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(input())
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__repr__'): object.__repr__})
assert seen == ['ready']
value = C()
assert repr(value) == object.__repr__(value)
assert seen == ['ready']
print('repr slot ready')
`}
] as const;
