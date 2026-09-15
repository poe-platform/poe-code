/** Whole guest programs run unchanged by the pinned external oracle. */
export const codecIncrementalReplayCases = [
  ...['utf-8', 'utf-8-sig', 'utf-7', 'utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be', 'unicode-escape', 'raw-unicode-escape'].flatMap(encoding => Array.from({length: 8}, (_, shard) => ({
    name: `${encoding} three-chunk splits and state transfer, shard ${shard}`,
    source: `
import codecs
encoding = '${encoding}'
text = 'Aé🐍\\ud800.\\udc80Z'
data = codecs.encode(text, encoding, 'surrogatepass')
expected = codecs.decode(data, encoding, 'surrogatepass')
factory = codecs.getincrementaldecoder(encoding)
count = 0
for first in range(${shard}, len(data) + 1, 8):
    for second in range(first, len(data) + 1):
        decoder = factory('surrogatepass')
        prefix = decoder.decode(data[:first])
        state = decoder.getstate()
        restored = factory('surrogatepass')
        assert restored.setstate(state) is None
        middle = decoder.decode(data[first:second])
        assert restored.decode(data[first:second]) == middle
        assert restored.getstate() == decoder.getstate()
        tail = decoder.decode(data[second:], True)
        assert restored.decode(data[second:], True) == tail
        assert type(prefix) is str and type(middle) is str and type(tail) is str
        assert prefix + middle + tail == expected, (first, second)
        assert restored.getstate() == decoder.getstate()
        assert decoder.reset() is None
        assert decoder.getstate() == factory('surrogatepass').getstate()
        assert decoder.decode(data, True) == expected
        count += 1
print(encoding, len(data), count)
`,
  }))),
  {
    name: 'UTF-8 callback state mutation, failure, negative resume and retry',
    source: `
import codecs
decoder = codecs.getincrementaldecoder('utf-8')('state_replay')
failure = ValueError('callback failed')
events = []
fail = True
class Position:
    def __index__(self):
        events.append('index')
        decoder.buffer = b'index mutation'
        decoder.errors = 'strict'
        return -1
def recover(error):
    events.append((error.object, error.start, error.end, error.reason))
    decoder.buffer = b'callback mutation'
    assert input() == 'continue'
    if fail:
        raise failure
    return ('!', Position())
codecs.register_error('state_replay', recover)
assert decoder.decode(b'\\xe2') == ''
saved = decoder.getstate()
try:
    decoder.decode(b'Z', True)
except ValueError as caught:
    assert caught is failure
else:
    assert False
assert decoder.getstate() == (b'callback mutation', 0)
assert saved == (b'\\xe2', 0)
decoder.setstate(saved)
fail = False
assert decoder.decode(b'Z', True) == '!Z'
assert decoder.getstate() == (b'', 0)
assert decoder.errors == 'strict'
assert events == [(b'\\xe2Z', 0, 1, 'invalid continuation byte'), (b'\\xe2Z', 0, 1, 'invalid continuation byte'), 'index']
print('callback retry verified')
`,
  },
];
