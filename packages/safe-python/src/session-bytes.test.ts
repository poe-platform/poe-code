import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

export const bytesContracts = [
  {name:"construction and identity",source:String.raw`
assert type(b'abc') is bytes
assert bytes() is b''
assert bytes(3) == b'\0\0\0'
assert bytes(True) == b'\0'
assert bytes([0, 65, 255]) == b'\0A\xff'
assert bytes((65, 66)) == b'AB'
assert bytes(iter([65, 66])) == b'AB'
a = b'abc'
assert bytes(a) is a
assert bytes('é', 'utf-8') == b'\xc3\xa9'
assert bytes(source='é', encoding='ascii', errors='replace') == b'?'
assert bytes.__new__(bytes, [65]) == b'A'
`},
  {name:"subtype storage and descriptors",source:String.raw`
class B(bytes):
    pass
b = B([65, 66])
assert type(b) is B
assert isinstance(b, bytes)
assert bytes(b) == b'AB'
assert type(bytes(b)) is bytes
assert bytes.__bytes__(b) == b'AB'
assert bytes.__getnewargs__(b) == (b'AB',)
assert b[0] == 65
assert type(b[:]) is bytes
assert b + b'C' == b'ABC'
assert b'C' + b == b'CAB'
assert b * 2 == b'ABAB'
assert 2 * b == b'ABAB'
assert b == b'AB'
assert hash(b) == hash(b'AB')
assert list(b) == [65, 66]
assert 65 in b
assert b'A' in b
assert str(b) == "b'AB'"
assert repr(b) == "b'AB'"
b.tag = 3
assert b.tag == 3
assert b.lower() == b'ab'
assert bytes.lower(b) == b'ab'
assert type(b.lower()) is bytes
assert b.decode() == 'AB'
assert str(b, 'ascii') == 'AB'
assert type(B.fromhex('4142')) is B
assert B.fromhex('4142') == b
assert bytes.fromhex(b'4142') == b'AB'
assert bytes.maketrans(b'a', b'b')[97] == 98
assert bytes.lower.__objclass__ is bytes
assert b.lower.__self__ is b
assert bytes.__new__.__self__ is bytes
`},
  {name:"protocol order and mutation",source:String.raw`
events = []
class Both:
    def __bytes__(self):
        events.append('bytes')
        return b'ok'
    def __index__(self):
        assert False
    def __iter__(self):
        assert False
assert bytes(Both()) == b'ok'
assert events == ['bytes']
class Count:
    def __index__(self):
        return 2
assert bytes(Count()) == b'\0\0'
class BadIndexIterable:
    def __index__(self):
        raise TypeError('fallback')
    def __iter__(self):
        return iter([65])
assert bytes(BadIndexIterable()) == b'A'
class B(bytes):
    pass
result = B(b'x')
class Converts:
    def __bytes__(self):
        return result
assert bytes(Converts()) is result
assert type(B(Converts())) is B
assert B(Converts()) is not result
items = []
class Item:
    def __index__(self):
        items.append(66)
        return 65
items.append(Item())
assert bytes(items) == b'AB'
`},
  {name:"method results and subtype identity",source:String.raw`
class B(bytes):
    pass
b = B(b'ab')
for call in (lambda: bytes(b), lambda: b.__bytes__(), lambda: b.__getnewargs__()[0], lambda: b[:], lambda: b.strip(), lambda: b.removeprefix(b'z'), lambda: b.replace(b'z', b'!'), lambda: b.center(0)):
    a = call()
    c = call()
    assert type(a) is bytes
    assert a == b
    assert a is not c
for data in (b'', b'A'):
    b = B(data)
    assert bytes(b) is data
    assert b.__getnewargs__()[0] is data
    assert b[:] is data
    assert b.strip() is data
    assert b.removeprefix(b'z') is data
b = B(b'ab')
assert b.partition(b'z')[0] is b
assert b.rpartition(b'z')[2] is b
sep = B(b'b')
assert b.partition(sep)[1] is sep
assert b'!'.join([B(b'a'), B(b'b')]) == b'a!b'
assert b.strip(B(b'a')) == b'b'
assert b.replace(B(b'a'), B(b'x')) == b'xb'
assert b.startswith(B(b'a'))
assert b.find(B(b'b')) == 1
assert b.split(B(b'b')) == [b'a', b'']
assert b.translate(bytes.maketrans(B(b'a'), B(b'x'))) == b'xb'
class S(str):
    pass
assert bytes.fromhex(S('4142')) == b'AB'
`},
  {name:"sequence reflection and repetition",source:String.raw`
class B(bytes):
    pass
class Reflected:
    def __radd__(self, other):
        return 'reflected add'
    def __rmul__(self, other):
        return 'reflected multiply'
b = B(b'ab')
assert b + Reflected() == 'reflected add'
assert b * Reflected() == 'reflected multiply'
assert type(b * 1) is bytes
assert b * 1 is not b * 1
assert type(b * 0) is bytes
assert b * 0 is not b * 0
empty = B()
assert empty * 1 is not empty * 1
class Override(B):
    def __rmod__(self, other):
        return 'reflected percent'
assert b'%s' % Override(b'x') == 'reflected percent'
`},
  {name:"native documentation and signatures",source:String.raw`
assert bytes.__doc__.startswith('bytes(iterable_of_ints) -> bytes')
assert bytes.__new__.__text_signature__ == '($type, *args, **kwargs)'
assert bytes.__repr__.__text_signature__ == '($self, /)'
assert bytes.__bytes__.__text_signature__ == '($self, /)'
assert bytes.hex.__text_signature__ == '($self, /, sep=<unrepresentable>, bytes_per_sep=1)'
assert b'a'.hex.__text_signature__ == bytes.hex.__text_signature__
assert bytes.maketrans.__text_signature__ == '(frm, to, /)'
assert bytes.maketrans.__doc__.startswith('Return a translation table usable for the bytes or bytearray translate method.')
assert bytes.__dict__['maketrans'].__doc__ == staticmethod.__doc__
assert bytes.__dict__['maketrans'].__dict__ == {}
assert bytes.fromhex.__text_signature__ == '($type, string, /)'
assert bytes.lower.__doc__ == "B.lower() -> copy of B\n\nReturn a copy of B with all ASCII characters converted to lowercase."
assert bytes.lower.__qualname__ == 'bytes.lower'
`},
  {name:"validation precedence",source:String.raw`
for call, kind, message in [
    (lambda: bytes(-1), ValueError, 'negative count'),
    (lambda: bytes(2**64), OverflowError, "cannot fit 'int' into an index-sized integer"),
    (lambda: bytes(2**63-1), OverflowError, 'byte string is too large'),
    (lambda: bytes([256]), ValueError, 'bytes must be in range(0, 256)'),
    (lambda: bytes([-1]), ValueError, 'bytes must be in range(0, 256)'),
    (lambda: bytes([1.0]), TypeError, "'float' object cannot be interpreted as an integer"),
    (lambda: bytes('x'), TypeError, 'string argument without an encoding'),
    (lambda: bytes(encoding='ascii'), TypeError, 'encoding without a string argument'),
    (lambda: bytes(errors='strict'), TypeError, 'errors without a string argument'),
    (lambda: bytes('x', errors='strict'), TypeError, 'string argument without an encoding'),
    (lambda: bytes(1, 'ascii'), TypeError, 'encoding without a string argument'),
    (lambda: bytes(None), TypeError, "cannot convert 'NoneType' object to bytes"),
    (lambda: bytes('x', None), TypeError, "bytes() argument 'encoding' must be str, not None"),
    (lambda: bytes('x', 'ascii', None), TypeError, "bytes() argument 'errors' must be str, not None"),
]:
    try:
        call()
    except kind as error:
        assert str(error) == message, (str(error), message)
    else:
        assert False, message
`}
];
it.each(bytesContracts)("implements native bytes: $name",({source})=>{
  const session=new PythonSession({limits:{maxSteps:2000000,maxAllocatedBytes:16000000,maxDepth:100},hashSeed:[1n,2n]});
  const result=session.exec(source);
  let diagnostic:unknown=result;
  if(result.status==='exception'){session.globals.set('failure',result.exception);diagnostic=session.eval('repr(failure)');}
  expect(result.status,JSON.stringify(diagnostic,(_key,value)=>typeof value==='bigint'?String(value):value)).toBe('ok');
});
