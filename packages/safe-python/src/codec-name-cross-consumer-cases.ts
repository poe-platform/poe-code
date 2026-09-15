const consumers = [
  "codecs.lookup(name)",
  "codecs.lookup_error('surrogatepass')(UnicodeEncodeError(name, '\\ud800', 0, 1, 'x'))",
  "codecs.readbuffer_encode(name)",
  "codecs.register_error(name, handler)",
  "codecs.lookup_error(name)",
  "_codecs._unregister_error(name)",
  "codecs.encode('x', name)",
  "codecs.decode(b'x', name)",
  "'x'.encode(name)",
  "b'x'.decode(name)",
  "bytes('x', name)",
  "str(b'x', name)",
  "codecs.utf_8_encode('x', name)",
  "codecs.utf_16_le_encode('x', name)",
  "codecs.utf_32_be_decode(b'', name)",
  "codecs.encode('x', 'utf8', name)",
  "codecs.decode(b'x', 'utf8', name)"
];

/** Every producer is followed by the same consumers after strict restoration
 * and search invalidation. The exact programs also run on the external oracle. */
export const codecNameCrossConsumerCases = [false, true].flatMap(subtype => consumers.map(producer => ({
  name: `${subtype ? 'subtype' : 'str'} cache from ${producer}`,
  source: String.raw`
import codecs, _codecs
original = codecs.lookup_error('strict')
class Name(str):
    def __str__(self):
        raise AssertionError('str hook')
    def encode(self, *args):
        raise AssertionError('encode hook')
name = ${subtype ? "Name('utf\\ud800')" : "''.join(['utf', '\\ud800'])"}
other = ${subtype ? "Name('utf\\ud800')" : "''.join(['utf', '\\ud800'])"}
assert name == other and name is not other
seen = []
handler = lambda error: ('?', error.end)
codecs.register_error('utf8', handler)
def repair(error):
    assert error.object is name
    seen.append((error.encoding, error.start, error.end, error.reason))
    return (b'8', error.end)
codecs.register_error('strict', repair)
${producer}
codecs.register_error('strict', original)
search = lambda normalized: None
codecs.register(search)
codecs.unregister(search)
assert codecs.lookup(name).name == 'utf-8'
assert codecs.readbuffer_encode(name) == (b'utf8', 4)
codecs.register_error(name, handler)
assert codecs.lookup_error(name) is handler
assert codecs.encode('x', name) == b'x'
assert codecs.decode(b'x', name) == 'x'
assert 'x'.encode(name) == b'x'
assert b'x'.decode(name) == 'x'
assert bytes('x', name) == b'x'
assert str(b'x', name) == 'x'
assert codecs.encode('\ud800', 'utf8', name) == b'?'
assert codecs.decode(b'\xff', 'utf8', name) == '?'
assert '\ud800'.encode('utf8', name) == b'?'
assert b'\xff'.decode('utf8', name) == '?'
assert bytes('\ud800', 'utf8', name) == b'?'
assert str(b'\xff', 'utf8', name) == '?'
assert codecs.utf_8_encode('\ud800', name) == (b'?', 1)
assert codecs.utf_16_le_encode('\ud800', name) == (b'?\x00', 1)
assert codecs.utf_32_be_decode(b'\xff', name, True) == ('?', 1)
assert _codecs._unregister_error(name) is True
assert _codecs._unregister_error(name) is False
try:
    codecs.lookup(other)
except UnicodeEncodeError as error:
    assert error.object is other
else:
    assert False
assert seen == [('utf-8', 3, 4, 'surrogates not allowed')]
print('ok', flush=True)
`
}))).concat([false, true].map(fails => ({
  name: `reentrant native conversion outer failure=${fails}`,
  source: String.raw`
import codecs
original = codecs.lookup_error('strict')
name = ''.join(['utf', '\ud800'])
seen = []
sentinel = ValueError('outer conversion')
def repair(error):
    assert error.object is name
    seen.append(len(seen))
    if len(seen) == 1:
        assert codecs.readbuffer_encode(name) == (${fails ? "b'utf8', 4" : "b'utf16', 5"})
        ${fails ? 'raise sentinel' : "return (b'8', error.end)"}
    return (${fails ? "b'8'" : "b'16'"}, error.end)
codecs.register_error('strict', repair)
try:
    result = codecs.lookup(name)
except ValueError as error:
    assert ${fails ? 'True' : 'False'} and error is sentinel
else:
    assert ${fails ? 'False' : 'True'} and result.name == 'utf-8'
codecs.register_error('strict', original)
assert codecs.lookup(name).name == 'utf-8'
assert codecs.readbuffer_encode(name) == (b'utf8', 4)
assert bytes('x', name) == b'x'
assert seen == [0, 1]
print('ok', flush=True)
`
})));
