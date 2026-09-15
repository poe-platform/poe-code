/** Each bounded program is executed unchanged by the external pinned oracle. */
const inputs = [
  ["utf-8", "b'A\\xe2\\x82Z\\xed\\xa0\\x80'"],
  ["utf-8-sig", "b'\\xef\\xbb\\xbfA\\xf0\\x9fZ'"],
  ["utf-7", "b'A+2AA-Z+IKw'"],
  ["utf-16-le", "b'A\\x00\\x00\\xd8Z\\x00\\x00'"],
  ["utf-16-be", "b'\\x00A\\xd8\\x00\\x00Z\\x00'"],
  ["utf-32-le", "b'\\x00\\xd8\\x00\\x00Z\\x00\\x00'"],
  ["utf-32-be", "b'\\x00\\x00\\xd8\\x00\\x00\\x00Z'"],
  ["unicode-escape", String.raw`br'A\u123Z\U0001'`],
  ["raw-unicode-escape", String.raw`br'A\u123Z\U0001'`],
  ["ascii", "b'A\\xffZ\\x80'"],
  ["cp1252", "b'A\\x81Z\\x8d'"],
] as const;

export const codecFragmentedFailureCases = inputs.flatMap(([encoding, input]) =>
  ["strict", "ignore", "replace", "backslashreplace", "surrogateescape", "surrogatepass", "namereplace", "xmlcharrefreplace"].flatMap(policy =>
    [0, 1, 2, 3].map(shard => ({
      name: `${encoding}/${policy}/split shard ${shard}`,
      source: `
import codecs
factory = codecs.getincrementaldecoder('${encoding}')
data = ${input}
def step(decoder, chunk, final):
    try:
        text = decoder.decode(chunk, final)
        assert type(text) is str
        result = ('text', text)
    except UnicodeDecodeError as error:
        result = ('unicode', type(error).__name__, error.args, error.encoding, error.object, error.start, error.end, error.reason)
    except Exception as error:
        result = ('failure', type(error).__name__, error.args)
    state = decoder.getstate()
    assert type(state) is tuple and len(state) == 2
    assert type(state[0]) is bytes and type(state[1]) is int
    return (result, state)
for first in range(${shard}, len(data) + 1, 4):
    for second in range(first, len(data) + 1):
        decoder = factory('${policy}')
        prefix = step(decoder, data[:first], False)
        saved = decoder.getstate()
        restored = factory('${policy}')
        assert restored.setstate(saved) is None
        middle = step(decoder, data[first:second], False)
        assert step(restored, data[first:second], False) == middle
        tail = step(decoder, data[second:], True)
        assert step(restored, data[second:], True) == tail
        empty = step(decoder, b'', True)
        assert step(restored, b'', True) == empty
        decoder.errors = 'replace'
        retry = step(decoder, b'', True)
        assert decoder.reset() is None
        reset = decoder.getstate()
        assert reset == factory().getstate()
        print(first, second, prefix, middle, tail, empty, retry, reset, saved)
`,
    }))));
