/** Each operation must reach the explicitly supplied input service during
 * C-string decoding, after the Unicode object's byte cache has been populated. */
export const codecCStringServiceCases = [
  'codecs.lookup_error(name) is handler',
  'codecs.register_error(name, handler)',
  '_codecs._unregister_error(name)',
  "codecs.encode('\u0100', 'ascii', name)",
  "codecs.decode(b'\\xff', 'ascii', name)",
  "codecs.ascii_encode('\u0100', name)",
  "codecs.utf_16_le_encode('\\ud801', name)",
  "'\u0100'.encode('ascii', name)",
  "b'\\xff'.decode('ascii', name)",
  "bytes('\u0100', 'ascii', name)",
  "str(b'\\xff', 'ascii', name)"
].map(operation => ({
  name: operation,
  source: String.raw`
import codecs, _codecs
name = '\ud800'
def strict(error):
    if isinstance(error, UnicodeEncodeError):
        return (b'\x80', error.end)
    return (input(), error.end)
codecs.register_error('strict', strict)
handler = lambda error: ('?', error.end)
codecs.register_error('custom', handler)
assert codecs.readbuffer_encode(name) == (b'\x80', 1)
print(repr(${operation}))
`
}));
