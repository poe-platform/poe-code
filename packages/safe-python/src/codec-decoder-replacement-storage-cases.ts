/** Complete guest programs replayed unchanged by the pinned external oracle. */
export const codecDecoderReplacementStorageCases = ['c2', 'c4', 'f0'].flatMap(byte =>
  ['', 'A', 'AB', 'é', '€', '🐍'].map(replacement => ({
    name: `${byte} / ${JSON.stringify(replacement)}`,
    source: String.raw`
import codecs
captured = []
def strict(error):
    return (bytes.fromhex('${byte}'), error.end) if isinstance(error, UnicodeEncodeError) else (${JSON.stringify(replacement)}, error.end)
codecs.register_error('strict', strict)
def capture(value, errors):
    captured.append(errors)
    return (value, 0)
codecs.register(lambda name: (capture, capture, None, None) if name == 'capture' else None)
codecs.encode('', 'capture', '\ud800')
replacement = captured[0]
codecs.register_error('storage', lambda error: (replacement, error.end))
for name, data in (('utf-8', b'\xff'), ('utf-16-le', b'\xff'), ('utf-16-be', b'\xff'), ('utf-32-le', b'\xff'), ('utf-32-be', b'\xff'), ('utf-7', b'\xff'), ('ascii', b'\xff'), ('unicode_escape', b'\\uQQQQ'), ('raw_unicode_escape', b'\\uQQQQ')):
    text = codecs.decode(data, name, 'storage')
    canonical = ''.join(chr(ord(c)) for c in text)
    print(name, repr(text), text.isascii(), text == canonical, text == replacement, text.encode('utf8', 'surrogatepass'))
    for split in range(len(data) + 1):
        decoder = codecs.getincrementaldecoder(name)('storage')
        first = decoder.decode(data[:split])
        state = decoder.getstate()
        restored = codecs.getincrementaldecoder(name)('storage')
        restored.setstate(state)
        second = restored.decode(data[split:], True)
        print(split, repr(first), first.isascii(), state, repr(second), second.isascii(), restored.getstate())
for mapping in ({}, {255: replacement}):
    text, consumed = codecs.charmap_decode(b'\xff', 'storage', mapping)
    canonical = ''.join(chr(ord(c)) for c in text)
    print('charmap', repr(text), text.isascii(), text == canonical, text == replacement, consumed)
`
  }))
);

export const codecDecoderReplacementStorageServiceCases = [
  'utf-8', 'utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be', 'utf-7', 'ascii', 'unicode_escape', 'raw_unicode_escape', 'charmap'
].flatMap(encoding => [false, true].map(raises => ({
  name: `${encoding} / raises=${raises}`,
  source: String.raw`
import codecs
captured = []
def strict(error):
    return (b'\xf0', error.end) if isinstance(error, UnicodeEncodeError) else ('AB', error.end)
codecs.register_error('strict', strict)
def capture(value, errors):
    captured.append(errors)
    return (value, 0)
codecs.register(lambda name: (capture, capture, None, None) if name == 'capture' else None)
codecs.encode('', 'capture', '\ud800')
replacement = captured[0]
failure = ValueError('resume failed')
events = []
class Position:
    def __init__(self, error):
        self.error = error
    def __index__(self):
        events.append(input())
        ${raises ? 'raise failure' : 'return self.error.end - len(self.error.object) if self.error.end < len(self.error.object) else self.error.end'}
codecs.register_error('storage', lambda error: (replacement, Position(error)))
try:
    text = ${encoding === 'charmap' ? "codecs.charmap_decode(b'\\xff', 'storage', {})[0]" : `codecs.decode(${encoding.includes('escape') ? "b'\\\\uQQQQ'" : "b'\\xff'"}, '${encoding}', 'storage')`}
    print(repr(text), text.isascii(), events)
except ValueError as error:
    print(error is failure, str(error), events)
`
})));
