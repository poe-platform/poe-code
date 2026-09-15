/** Run unchanged in PythonSession and the pinned external CPython oracle. */
export const codecEncodedFileCases = [
  {
    name: 'EncodedFile transcodes reads and writes through the registered stream codecs',
    source: String.raw`
import codecs
class Stream:
    def __init__(self, data):
        self.data = data
        self.position = 0
        self.written = []
        self.closed = False
    def read(self, size=-1):
        if size < 0:
            size = len(self.data)
        result = self.data[self.position:self.position + size]
        self.position += len(result)
        return result
    def write(self, data):
        self.written.append(data)
    def close(self):
        self.closed = True
stream = Stream(b'\xe9\nA\n')
wrapped = codecs.EncodedFile(stream, 'utf-8', 'latin-1')
assert type(wrapped) is codecs.StreamRecoder
assert wrapped.stream is stream
assert (wrapped.data_encoding, wrapped.file_encoding, wrapped.errors) == ('utf-8', 'latin-1', 'strict')
assert wrapped.readline() == b'\xc3\xa9\n'
assert wrapped.read() == b'A\n'
assert wrapped.read() == b''
assert wrapped.write(b'\xc3\xa9') is None
assert wrapped.writelines([b'X', b'\xc3\xa9']) is None
assert stream.written == [b'\xe9', b'X\xe9']
with wrapped as entered:
    assert entered is wrapped
assert stream.closed
class Name(str):
    def __str__(self):
        raise AssertionError('virtual name')
name = Name('utf-8')
same = codecs.EncodedFile(Stream(b'A'), name)
assert same.data_encoding is name and same.file_encoding is name
assert same.read() == b'A'
assert codecs.EncodedFile.__module__ == 'codecs'
assert codecs.EncodedFile.__name__ == 'EncodedFile'
assert codecs.EncodedFile.__qualname__ == 'EncodedFile'
assert codecs.EncodedFile.__defaults__ == (None, 'strict')
assert codecs.EncodedFile.__code__.co_firstlineno == 937
assert codecs.EncodedFile.__code__.co_filename == '<frozen codecs>'
`,
  },
  {
    name: 'EncodedFile observes live lookup, descriptors and StreamRecoder replacement in order',
    source: `
import codecs
events = []
stream, data, file, errors, result = object(), object(), object(), object(), type('Result', (), {})()
class Info:
    def __getattribute__(self, name):
        events.append(name)
        return name
info = Info()
def lookup(name):
    events.append(name)
    return info
def recoder(*args):
    events.append(args)
    return result
codecs.lookup = lookup
codecs.StreamRecoder = recoder
assert codecs.EncodedFile(file=stream, data_encoding=data, file_encoding=file, errors=errors) is result
assert events == [data, file, 'encode', 'decode', 'streamreader', 'streamwriter', (stream, 'encode', 'decode', 'streamreader', 'streamwriter', errors)]
assert result.data_encoding is data and result.file_encoding is file
events.clear()
assert codecs.EncodedFile(stream, data) is result
assert events[:2] == [data, data]
assert events[-1][-1] == 'strict'
assert result.file_encoding is data
`,
  },
  {
    name: 'EncodedFile preserves lookup and stream constructor failures and partial effects',
    source: `
import codecs
events = []
failure = ValueError('stream failure')
class Reader:
    def __init__(self, stream, errors):
        events.append(('reader', stream, errors))
class Writer:
    def __init__(self, stream, errors):
        events.append(('writer', stream, errors))
        raise failure
def transform(value, errors='strict'):
    return (value, len(value))
info = codecs.CodecInfo(transform, transform, Reader, Writer)
def search(name):
    events.append(name)
    return info
codecs.register(search)
stream = object()
try:
    codecs.EncodedFile(stream, 'encoded-file-data', 'encoded-file-target', 'custom')
except ValueError as caught:
    assert caught is failure
    assert not hasattr(caught, '__notes__')
else:
    raise AssertionError('writer failure lost')
assert events == ['encoded_file_data', 'encoded_file_target', ('reader', stream, 'custom'), ('writer', stream, 'custom')]
events.clear()
def lookup(name):
    events.append(name)
    raise failure
codecs.lookup = lookup
try:
    codecs.EncodedFile(stream, 'data', 'file')
except ValueError as caught:
    assert caught is failure
else:
    raise AssertionError('lookup failure lost')
assert events == ['data']
`,
  },
];

export const codecEncodedFileServiceSource = `
import codecs
events = []
def search(name):
    assert name == 'encoded_file_service'
    assert input() == 'continue'
    return codecs.lookup('utf-8')
codecs.register(search)
class Stream:
    def write(self, data):
        assert data == b'encoded'
        print('encoded')
stream = codecs.EncodedFile(Stream(), 'encoded-file-service')
stream.write(b'encoded')
print('finished')
`;
