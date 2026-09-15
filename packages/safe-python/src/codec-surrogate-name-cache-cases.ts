const setup = String.raw`
import codecs
seen = []
name = 'utf\ud800'
error = UnicodeEncodeError(name, '\ud800', 0, 1, 'original')
recover = codecs.lookup_error('surrogatepass')
`;

export const codecSurrogateNameServiceSource = setup + String.raw`
def strict(failure):
    seen.append(failure)
    return (input(), failure.end)
codecs.register_error('strict', strict)
assert recover(error) == (b'\xed\xa0\x80', 1)
assert recover(error) == (b'\xed\xa0\x80', 1)
assert len(seen) == 1
`;

export const codecSurrogateNameCacheCases = [
  {name: 'recovery through an input service', source: codecSurrogateNameServiceSource},
  {
    name: 'string subtype conversion bypasses virtual string methods',
    source: setup + String.raw`
class Name(str):
    def __str__(self):
        raise AssertionError('virtual str')
    def encode(self, *args):
        raise AssertionError('virtual encode')
name = Name(name)
error.encoding = name
def strict(failure):
    assert failure.object is name
    seen.append(failure)
    return ('8', failure.end)
codecs.register_error('strict', strict)
assert recover(error) == (b'\xed\xa0\x80', 1)
assert recover(error) == (b'\xed\xa0\x80', 1)
assert len(seen) == 1
`
  },
  {
    name: 'negative resume position before a NUL byte',
    source: setup + String.raw`
name = 'utf\ud800\x00'
error.encoding = name
def strict(failure):
    seen.append(failure)
    return ('8', -1)
codecs.register_error('strict', strict)
assert recover(error) == (b'\xed\xa0\x80', 1)
assert recover(error) == (b'\xed\xa0\x80', 1)
assert len(seen) == 1
`
  },
  ...["'8'", "b'8'", "b'8\\x00ignored'"].map(replacement => ({
    name: `recovered encoding bytes ${replacement}`,
    source: setup + String.raw`
def strict(failure):
    assert failure.object is name
    assert (failure.encoding, failure.start, failure.end, failure.reason) == ('utf-8', 3, 4, 'surrogates not allowed')
    seen.append(failure)
    return (${replacement}, failure.end)
codecs.register_error('strict', strict)
assert recover(error) == (b'\xed\xa0\x80', 1)
codecs.register_error('strict', lambda failure: ('16', failure.end))
assert recover(error) == (b'\xed\xa0\x80', 1)
other = UnicodeDecodeError(name, b'\xed\xa0\x80', 0, 1, 'other')
assert recover(other) == ('\ud800', 3)
assert len(seen) == 1
`
  })),
  {
    name: 'failed conversion retries without caching and preserves exception identity',
    source: setup + String.raw`
sentinel = ValueError('name conversion failed')
def strict(failure):
    seen.append(failure)
    raise sentinel
codecs.register_error('strict', strict)
for attempt in range(2):
    try:
        recover(error)
    except ValueError as failure:
        assert failure is sentinel
    else:
        assert False
assert len(seen) == 2
codecs.register_error('strict', lambda failure: ('8', failure.end))
assert recover(error) == (b'\xed\xa0\x80', 1)
`
  },
  {
    name: 'unrecognized recovered name caches bytes but raises original error',
    source: setup + String.raw`
def strict(failure):
    seen.append(failure)
    return (b'\xff', failure.end)
codecs.register_error('strict', strict)
for attempt in range(2):
    try:
        recover(error)
    except UnicodeEncodeError as failure:
        assert failure is error
    else:
        assert False
assert len(seen) == 1
`
  },
  {
    name: 'equal distinct strings own independent caches',
    source: setup + String.raw`
other_name = ''.join(['utf', '\ud800'])
assert other_name == name and other_name is not name
def strict(failure):
    seen.append(failure.object)
    return ('8' if len(seen) == 1 else '16', failure.end)
codecs.register_error('strict', strict)
assert recover(error) == (b'\xed\xa0\x80', 1)
other = UnicodeEncodeError(other_name, '\ud800', 0, 1, 'other')
assert recover(other) == (b'\x00\xd8', 1)
assert recover(error) == (b'\xed\xa0\x80', 1)
assert len(seen) == 2
`
  }
];
