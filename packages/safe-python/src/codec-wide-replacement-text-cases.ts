/** Executed unchanged by the pinned oracle and the public interpreter. */
export const codecWideReplacementTextCases = [16, 32].flatMap(width => ["", "_le", "_be"].flatMap(suffix => ["native", "str", "bytes"].map(consumer => ({
  name: `utf_${width}${suffix}_encode via ${consumer}`,
  stdout: `verified ${width}${suffix}\n`,
  source: String.raw`
import codecs
encoder = ${consumer === "native" ? `codecs.utf_${width}${suffix}_encode` : `lambda text, errors='strict': (${consumer === "str" ? `text.encode('utf-${width}${suffix.replaceAll("_", "-")}', errors)` : `bytes(text, 'utf-${width}${suffix.replaceAll("_", "-")}', errors)`}, len(text))`}
class Text(str):
    def __str__(self):
        raise AssertionError('virtual string conversion')
    def __iter__(self):
        raise AssertionError('virtual string iteration')
source = Text('\ud800A\udfffZ')
for replacement in ('\x80', 'é', '€', '🐍', 'aé', 'a\ud800', '\udfff', Text('é')):
    for reused in (False, True):
        seen = []
        events = []
        class Position:
            def __index__(self):
                events.append('index')
                seen[-1].start = 90
                seen[-1].end = 91
                seen[-1].reason = 'index mutation'
                return -1
        def handler(error):
            seen.append(error)
            if reused and len(seen) == 1:
                return ('?', error.end)
            error.encoding = 'changed encoding'
            error.object = 'changed object'
            error.start = 42
            error.end = 43
            error.reason = 'changed reason'
            return (replacement, Position())
        codecs.register_error('wide_text_replacement', handler)
        try:
            encoder(source, 'wide_text_replacement')
        except UnicodeEncodeError as error:
            assert error is seen[0] and error is seen[-1]
            assert error.encoding == 'changed encoding'
            assert error.object == 'changed object'
            assert (error.start, error.end, error.reason) == ((2, 3, 'surrogates not allowed') if reused else (0, 1, 'surrogates not allowed'))
            assert error.args == ('utf-${width}${suffix.replaceAll("_", "-")}', source, 0, 1, 'surrogates not allowed')
            assert error.args[1] is source
        else:
            raise AssertionError('non-ASCII replacement accepted')
        assert events == ['index']
        assert len(seen) == (2 if reused else 1)
for replacement in ('', '\x00\x7f', Text('ascii'), 'a' * 80):
    codecs.register_error('wide_text_replacement', lambda error: (replacement, -1))
    assert encoder(source, 'wide_text_replacement') == (encoder(replacement + 'Z')[0], 4)
raw = b'\xff' * ${width / 8}
codecs.register_error('wide_text_replacement', lambda error: (raw, -1))
assert encoder(source, 'wide_text_replacement') == (encoder('')[0] + raw + encoder('Z')[0][${suffix === "" ? width / 8 : 0}:], 4)
failure = ValueError('position failure')
class FailedPosition:
    def __index__(self):
        raise failure
codecs.register_error('wide_text_replacement', lambda error: ('é', FailedPosition()))
try:
    encoder(source, 'wide_text_replacement')
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('position failure lost')
print('verified ${width}${suffix}')
`
}))));

export const codecWideReplacementServiceCases = [16, 32].flatMap(width => ["", "_le", "_be"].flatMap(suffix => [false, true].map(throws => ({
  name: `utf_${width}${suffix}: position ${throws ? "raises" : "returns"}`,
  stdout: `verified ${width}${suffix} ${throws}\n`,
  source: String.raw`
import codecs
seen = []
events = []
failure = ValueError('position failure')
class Position:
    def __index__(self):
        events.append(input())
        ${throws ? "raise failure" : "return -1"}
def handler(error):
    seen.append(error)
    return ('é', Position())
codecs.register_error('serviced_wide_replacement', handler)
try:
    codecs.utf_${width}${suffix}_encode('\ud800Z', 'serviced_wide_replacement')
except ${throws ? "ValueError" : "UnicodeEncodeError"} as error:
    assert error is ${throws ? "failure" : "seen[0]"}
else:
    raise AssertionError('replacement was accepted')
assert events == ['continue']
assert len(seen) == 1
print('verified ${width}${suffix} ${throws}')
`
}))));
