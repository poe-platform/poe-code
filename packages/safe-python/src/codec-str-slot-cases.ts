/** Programs replayed unchanged against the pinned external interpreter. */
export const codecStrSlotCases = [
  {name: "absent str validates the repr fallback as repr", source: `
import codecs
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            raise ValueError('str fixup')
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__str__'): lambda self: 'unused', '__repr__': lambda self: 17})
try:
    str(C())
except TypeError as error:
    assert error.args == ('__repr__ returned non-string (type int)',), error.args
else:
    assert False
`},
  {name: "str readiness follows repr and hash", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__repr__'): lambda self: 'repr', Key('__hash__'): lambda self: 7, Key('__str__'): lambda self: 'text'})
assert seen == ['__hash__'] * 3 + ['__repr__', '__hash__', '__str__'], seen
assert str(C()) == 'text'
`},
  {name: "failed str fixup falls back to repr and retains explicit access", source: `
import codecs
seen = []
failure = ValueError('str fixup')
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other)
            if len(seen) == 1:
                raise failure
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__str__'): lambda self: 'text', '__repr__': lambda self: 'repr'})
assert seen == ['__str__'], seen
value = C()
assert str(value) == 'repr'
assert seen == ['__str__'], seen
assert C.__str__(value) == 'text'
C.__str__ = lambda self: 'recovered'
assert str(value) == 'recovered'
`},
  {name: "str descriptor results and native wrapper rebinding", source: `
import codecs
seen = []
class Text(str):
    pass
result = Text('decoded')
class Descriptor:
    def __get__(self, instance, owner):
        seen.append((instance, owner))
        return lambda: result
class C(codecs.IncrementalDecoder):
    __str__ = Descriptor()
    def __repr__(self):
        return 'repr'
assert seen == []
value = C()
assert str(value) is result
assert seen == [(value, C)]
C.__str__ = None
try:
    str(value)
except TypeError as error:
    assert error.args == ("'NoneType' object is not callable",)
else:
    assert False
C.__str__ = lambda self: 17
try:
    str(value)
except TypeError as error:
    assert error.args == ('__str__ returned non-string (type int)',)
else:
    assert False
C.__str__ = object.__str__
assert str(value) == 'repr'
`},
  {name: "str mutation refreshes diamond descendants and preserves overrides", source: `
import codecs
class Base(codecs.IncrementalDecoder):
    def __str__(self):
        return 'first'
    def __repr__(self):
        return 'repr'
class Left(Base):
    pass
class Right(Base):
    pass
class Child(Left, Right):
    pass
class Own(Child):
    def __str__(self):
        return 'own'
value = Child()
own = Own()
assert str(value) == 'first'
Base.__str__ = lambda self: 'second'
assert str(value) == 'second' and str(own) == 'own'
del Base.__str__
assert str(value) == 'repr' and str(own) == 'own'
Child.__str__ = object.__str__
assert str(value) == 'repr'
`},
  {name: "str readiness invokes the explicit input service", source: `
import codecs
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(input())
        return str.__eq__(self, other)
C = type('C', (codecs.IncrementalDecoder,), {Key('__str__'): object.__str__, '__repr__': lambda self: 'decoder'})
assert seen == ['ready']
assert str(C()) == 'decoder'
assert seen == ['ready']
print('str slot ready')
`}
] as const;
