/** Preserve the complete program for external differential replay. */
export const codecCStringStorageCases = ['80', 'c2', 'c4', 'f0', 'ff'].flatMap(byte =>
  ['custom', 'x', '', '\u0100', '\ud800'].map(replacement => ({
    name: `${byte} replaced by ${JSON.stringify(replacement)}`,
    source: String.raw`
import codecs, _codecs
name = '\ud800'
replacement = ${JSON.stringify(replacement)}
def strict(error):
    return (bytes.fromhex('${byte}'), error.end) if isinstance(error, UnicodeEncodeError) else (replacement, error.end)
codecs.register_error('strict', strict)
def capture(value, errors):
    print(type(errors).__name__, repr(errors), errors == replacement, errors != replacement, errors <= replacement, errors >= replacement, hash(errors) == hash(replacement), errors.isascii())
    print(repr(errors.encode('utf8', 'surrogatepass')))
    print(repr(errors[:]), errors[:] == errors, repr(str(errors)), str(errors) is errors)
    print({errors: 'recovered', replacement: 'canonical'})
    return (value, 0)
codecs.register(lambda name: (capture, capture, None, None) if name == 'capture' else None)
codecs.encode('value', 'capture', name)
handler = lambda error: ('?', error.end)
codecs.register_error(replacement, handler)
try:
    print('canonical lookup', codecs.lookup_error(name) is handler)
except LookupError as error:
    print(type(error).__name__, str(error))
codecs.register_error(name, handler)
print('recovered lookup', codecs.lookup_error(name) is handler)
print('unregister', _codecs._unregister_error(name))
`
  }))
);
