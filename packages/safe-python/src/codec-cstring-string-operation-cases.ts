export const codecCStringStringOperationCases = ['c2', 'c4', 'f0'].map(byte => ({
  name: `${byte} recovered string operations`,
  source: String.raw`
import codecs
name = '\ud800'
def strict(error):
    return (bytes.fromhex('${byte}'), error.end) if isinstance(error, UnicodeEncodeError) else ('abc', error.end)
codecs.register_error('strict', strict)
def capture(value, errors):
    for text, canonical in [(errors * 2, 'abcabc'), (errors + 'x', 'abcx'), ('x' + errors, 'xabc'), (','.join([errors, 'x']), 'abc,x'), (errors.join(['x', 'y']), 'xabcy'), (errors.ljust(5), 'abc  '), (errors.replace('a', 'x'), 'xbc'), (errors[1:], 'bc'), (errors.upper(), 'ABC')]:
        print(repr(text), text == canonical, hash(text) == hash(canonical), text.isascii(), repr(text.encode()))
    for text, canonical in [(errors.replace(errors, 'x'), 'x'), ('abc'.replace(errors, 'x'), 'abc'), (errors.replace('abc', ''), ''), (errors.replace('abc', errors), 'abc')]:
        print(repr(text), text == canonical, hash(text) == hash(canonical), text.isascii())
    return (value, 0)
codecs.register(lambda name: (capture, capture, None, None) if name == 'capture' else None)
codecs.encode('value', 'capture', name)
`
}));
