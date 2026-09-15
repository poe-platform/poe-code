/** Programs replayed unchanged against CPython 3.14.7 and PythonSession. */
export const codecUtf7ReplacementCases = [
  {
    name: "replacement input retains the original final fault end and consumed count",
    source: String.raw`
import codecs
for source in (b'\xff', b'\xff0123456789'):
    for replacement in (b'+A', b'X+A', b'+2AA'):
        events = []
        faults = []
        def handler(error):
            faults.append(error)
            events.append((error.object, error.start, error.end, error.reason))
            if len(events) == 1:
                error.object = replacement
                return ('?', 0)
            return ('!', len(error.object))
        codecs.register_error('utf7_replaced', handler)
        assert codecs.utf_7_decode(source, 'utf7_replaced', True) == ('?X!' if replacement == b'X+A' else '?!', len(source))
        assert faults[0] is faults[1]
        assert faults[0].object is replacement
        assert faults[0].args == ('utf7', source, 0, 1, 'unexpected special character')
        assert events == [(source, 0, 1, 'unexpected special character'), (replacement, 1 if replacement == b'X+A' else 0, len(source), 'unterminated shift sequence')]
`,
  },
  {
    name: "negative resume positions use replacement length despite original fault end",
    source: String.raw`
import codecs
seen = []
def handler(error):
    seen.append((error.object, error.start, error.end))
    if len(seen) == 1:
        error.object = b'X+A'
        return ('?', 0)
    return ('!', -1)
codecs.register_error('utf7_negative', handler)
assert codecs.utf_7_decode(b'\xff', 'utf7_negative', True) == ('?X!A', 1)
assert seen == [(b'\xff', 0, 1), (b'X+A', 1, 1)]
seen.clear()
def invalid(error):
    seen.append(error)
    if len(seen) == 1:
        error.object = b'+A'
        return ('?', 0)
    return ('!', error.end)
codecs.register_error('utf7_negative', invalid)
try:
    codecs.utf_7_decode(b'\xff0123456789', 'utf7_negative', True)
except IndexError as error:
    assert error.args == ('position 11 from error handler out of bounds',)
else:
    assert False
assert len(seen) == 2 and seen[0] is seen[1]
`,
  },
  {
    name: "nonfinal rollback keeps the original incremental input buffer",
    source: String.raw`
import codecs
seen = []
def handler(error):
    seen.append(error)
    error.object = b'X+A'
    return ('?', 0)
codecs.register_error('utf7_buffer', handler)
source = b'\xff0123456789'
assert codecs.utf_7_decode(source, 'utf7_buffer', False) == ('?X', 1)
decoder = codecs.getincrementaldecoder('utf-7')('utf7_buffer')
assert decoder.decode(source) == '?X'
assert decoder.getstate() == (b'0123456789', 0)
assert decoder.decode(b'', True) == '0123456789'
assert decoder.getstate() == (b'', 0)
assert len(seen) == 2 and seen[0] is not seen[1]
`,
  },
  {
    name: "registry mutation preserves the active handler and guest failure identity",
    source: String.raw`
import codecs
seen = []
failure = ValueError('second fault')
def replacement(error):
    return ('new', len(error.object))
def handler(error):
    seen.append(error)
    if len(seen) == 1:
        codecs.register_error('utf7_cached', replacement)
        error.object = b'+A'
        return ('?', 0)
    raise failure
codecs.register_error('utf7_cached', handler)
decoder = codecs.getincrementaldecoder('utf7')('utf7_cached')
decoder.setstate((b'\xff', 0))
try:
    decoder.decode(b'', True)
except ValueError as error:
    assert error is failure
else:
    assert False
assert seen[0] is seen[1]
assert decoder.getstate() == (b'\xff', 0)
assert decoder.decode(b'', True) == 'new'
assert decoder.getstate() == (b'', 0)
`,
  },
] as const;
