import {singleByteTables} from './runtime/single-byte-tables.js';

/** Run unchanged through PythonSession and the pinned external CPython oracle. */
export const singleByteLibraryCases = singleByteTables.map(({name}) => ({name, source: `
import codecs
info = codecs.lookup('${name}')
seen = []
def recover(error):
    seen.append((error.encoding, error.object, error.start, error.end, error.reason))
    return (b'?', -1)
codecs.register_error('resume', recover)
expected = 'A'.encode('${name}') + b'?' + 'B'.encode('${name}')
assert codecs.encode('A\\ud800B', '${name}', 'resume') == expected
assert seen == [('charmap', 'A\\ud800B', 1, 2, 'character maps to <undefined>')]
encoder = info.incrementalencoder('resume')
assert encoder.encode('A\\ud800B', True) == expected
assert encoder.getstate() == 0
encoder.setstate(object())
assert encoder.getstate() == 0
failure = ValueError('handler failure')
def fail(error):
    raise failure
codecs.register_error('fail', fail)
try:
    codecs.encode('\\ud800', '${name}', 'fail')
except ValueError as error:
    assert error is failure
    assert error.__notes__ == ["encoding with '${name}' codec failed"]
else:
    assert False
class Stream:
    def __init__(self, data=b''):
        self.data = data
        self.position = 0
    def write(self, data):
        self.data += data
    def read(self, size=-1):
        if size < 0:
            size = len(self.data) - self.position
        result = self.data[self.position:self.position + size]
        self.position += len(result)
        return result
    def seek(self, offset, whence=0):
        assert whence == 0
        self.position = offset
    def tell(self):
        return self.position
stream = Stream()
writer = info.streamwriter(stream, 'resume')
assert writer.write('A\\ud800B') is None
assert stream.data == expected
writer.reset()
writer.writelines(['A', 'B'])
assert stream.data == expected + 'AB'.encode('${name}')
stream = Stream('AB\\nCD'.encode('${name}'))
reader = info.streamreader(stream)
assert reader.read(1) == 'A'
assert reader.readline() == 'B\\n'
assert reader.read() == 'CD'
assert reader.read() == ''
reader.seek(0)
assert reader.read() == 'AB\\nCD'
decoder = info.incrementaldecoder()
assert decoder.decode('AB'.encode('${name}'), True) == 'AB'
assert decoder.getstate() == (b'', 0)
decoder.setstate(object())
assert decoder.getstate() == (b'', 0)
` }));

export const codecMappingHelperSource = `
import codecs
class Key:
    def __hash__(self):
        return 1
    def __eq__(self, other):
        return self is other
key = Key()
mapping = codecs.make_identity_dict([key, key, 3, None])
assert list(mapping) == [key, 3, None]
assert mapping[key] is key and mapping[None] is None
assert codecs.make_identity_dict(range(-2, 2)) == {-2: -2, -1: -1, 0: 0, 1: 1}
events = []
class Map:
    def items(self):
        events.append('items')
        yield (10, key)
        yield (11, None)
        yield (12, key)
        yield (13, 3)
        yield (14, key)
assert codecs.make_encoding_map(Map()) == {key: None, None: 11, 3: 13}
assert events == ['items']
failure = ValueError('hash failure')
class Bad:
    def __hash__(self):
        raise failure
for call in (lambda: codecs.make_identity_dict([Bad()]), lambda: codecs.make_encoding_map({0: Bad()})):
    try:
        call()
    except ValueError as error:
        assert error is failure
    else:
        assert False
assert codecs.make_identity_dict.__module__ == 'codecs'
assert codecs.make_encoding_map.__module__ == 'codecs'
assert codecs.make_identity_dict.__code__.co_firstlineno == 1081
assert codecs.make_encoding_map.__code__.co_firstlineno == 1091
`;
