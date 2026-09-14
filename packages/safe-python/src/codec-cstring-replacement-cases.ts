/** The exact same programs run in the external oracle and in PythonSession. */
export const codecCStringReplacementCases = ['c2', 'c4', 'f0'].flatMap(lead => ['8', '88'].map(replacement => ({
  name: `${lead} decoded ${replacement} as UTF-8 replacement`,
  source: String.raw`
import codecs, _codecs
original = codecs.lookup_error('strict')
retained = []
def recover_name(error):
    input()
    if isinstance(error, UnicodeEncodeError):
        return (bytes.fromhex('${lead}'), error.end)
    return ('${replacement}', error.end)
def capture(value, errors):
    retained.append(errors)
    return (value, 0)
codecs.register(lambda name: (capture, capture, None, None) if name == 'capture' else None)
codecs.register_error('strict', recover_name)
codecs.encode('', 'capture', '\ud801')
recovered = retained[0]
print(repr(recovered), recovered.isascii())
class Name(str):
    def __str__(self):
        raise AssertionError('virtual str')
    def encode(self, *args):
        raise AssertionError('virtual encode')
operations = [
    lambda name: codecs.lookup(name),
    lambda name: codecs.register_error(name, capture),
    lambda name: codecs.lookup_error(name),
    lambda name: _codecs._unregister_error(name),
    lambda name: codecs.encode('x', name),
    lambda name: codecs.decode(b'x', name),
    lambda name: codecs.encode('x', 'utf8', name),
    lambda name: codecs.decode(b'x', 'utf8', name),
    lambda name: codecs.ascii_encode('x', name),
    lambda name: codecs.utf_16_le_encode('x', name),
    lambda name: 'x'.encode(name),
    lambda name: b'x'.decode(name),
    lambda name: bytes('x', name),
    lambda name: str(b'x', name),
    lambda name: codecs.readbuffer_encode(name),
    lambda name: codecs.escape_decode(name),
    lambda name: codecs.lookup_error('surrogatepass')(UnicodeEncodeError(name, '\ud800', 0, 1, 'outer')),
]
for operation in operations:
    name = Name('utf\ud800')
    seen = []
    class Position:
        def __index__(self):
            seen.append('index')
            input()
            return 4
    def strict(error):
        seen.append(error)
        assert error.object is name
        return (recovered, Position())
    codecs.register_error('strict', strict)
    for attempt in range(2):
        try:
            operation(name)
            print('ok')
        except UnicodeEncodeError as error:
            print(type(error).__name__, error is seen[-2], error.object is name, error.encoding, error.start, error.end, error.reason)
        except Exception as error:
            print(type(error).__name__, str(error))
    print(len(seen))
    codecs.register_error('strict', lambda error: (b'8', error.end))
    try:
        print(codecs.lookup(name).name)
    except Exception as error:
        print(type(error).__name__, str(error))
codecs.register_error('strict', original)
for operation in [codecs.ascii_encode, codecs.latin_1_encode, codecs.utf_8_encode, codecs.utf_16_encode, codecs.utf_32_encode]:
    seen = []
    def replacement_handler(error):
        seen.append(error)
        return (recovered, error.end)
    codecs.register_error('replacement', replacement_handler)
    try:
        print(operation.__name__, operation('\ud800', 'replacement'))
    except UnicodeEncodeError as error:
        print(operation.__name__, type(error).__name__, error is seen[-1], error.encoding, error.start, error.end, error.reason)
for encoding in ['ascii', 'latin1', 'utf8', 'utf16', 'utf32']:
    seen = []
    def replacement_handler(error):
        seen.append(error)
        return (recovered, error.end)
    codecs.register_error('replacement', replacement_handler)
    for operation in [lambda: codecs.encode('\ud800', encoding, 'replacement'), lambda: '\ud800'.encode(encoding, 'replacement'), lambda: bytes('\ud800', encoding, 'replacement')]:
        try:
            print(encoding, operation())
        except UnicodeEncodeError as error:
            print(encoding, type(error).__name__, error is seen[-1], error.encoding, error.start, error.end, error.reason)
        except Exception as error:
            print(encoding, type(error).__name__, str(error))
`
})));

export const codecCStringReentryCases = ['return', 'raise', 'invalid'].map(outcome => ({
  name: `Unicode cache reentry outer ${outcome}`,
  source: String.raw`
import codecs
original = codecs.lookup_error('strict')
class Name(str):
    pass
name = Name('utf\ud800')
seen = []
sentinel = ValueError('outer failed')
def inner(error):
    assert error.object is name
    seen.append('inner')
    input()
    return (b'8', error.end)
def outer(error):
    assert error.object is name
    seen.append('outer')
    codecs.register_error('strict', inner)
    print(codecs.readbuffer_encode(name))
    print(codecs.lookup(name).name)
    input()
    ${outcome === 'raise' ? 'raise sentinel' : outcome === 'invalid' ? 'return (42, error.end)' : "return (b'_16_le', error.end)"}
codecs.register_error('strict', outer)
try:
    print(codecs.lookup(name).name)
except Exception as error:
    print(type(error).__name__, error is sentinel, str(error))
codecs.register_error('strict', original)
search = lambda name: None
codecs.register(search)
codecs.unregister(search)
print(codecs.lookup(name).name)
print(codecs.readbuffer_encode(name))
print(seen)
`
}));
