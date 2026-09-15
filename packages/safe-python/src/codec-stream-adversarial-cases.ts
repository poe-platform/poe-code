/** Complete guest programs also executed unchanged by the pinned external oracle. */
export const codecStreamAdversarialCases = [
  {name: 'all scoped class dictionary and weakref descriptors preserve receiver contracts', source: `
import codecs
from encodings import ascii, latin_1, utf_8
groups = ((codecs, ('Codec', 'IncrementalEncoder', 'BufferedIncrementalEncoder', 'IncrementalDecoder', 'BufferedIncrementalDecoder', 'StreamReader', 'StreamWriter', 'StreamReaderWriter', 'StreamRecoder')), (ascii, ('Codec', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamReader', 'StreamWriter', 'StreamConverter')), (latin_1, ('Codec', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamReader', 'StreamWriter', 'StreamConverter')), (utf_8, ('IncrementalEncoder', 'IncrementalDecoder', 'StreamReader', 'StreamWriter')))
for module, names in groups:
    for name in names:
        cls = getattr(module, name)
        instance = cls.__new__(cls)
        descriptors = {}
        for base in cls.__mro__:
            for member in ('__dict__', '__weakref__'):
                if member not in descriptors and member in vars(base):
                    descriptors[member] = vars(base)[member]
        dictionary = descriptors['__dict__']
        weakref = descriptors['__weakref__']
        marker = []
        namespace = dictionary.__get__(instance, cls)
        namespace['custom'] = marker
        print(module.__name__, name, instance.custom is marker, instance.__dict__ is namespace, weakref.__get__(instance, cls))
        replacement = {'replacement': marker}
        dictionary.__set__(instance, replacement)
        print(instance.__dict__ is replacement, namespace['custom'] is marker)
        del instance.__dict__
        print(instance.__dict__, replacement['replacement'] is marker)
        for descriptor in (dictionary, weakref):
            print(descriptor.__get__(None, cls) is descriptor)
            try:
                descriptor.__get__(42, int)
            except TypeError as error:
                print(error.args)
        try:
            weakref.__set__(instance, None)
        except AttributeError as error:
            print(error.args)
`},
  {name: 'buffer consumption invokes index after callback and preserves failed mutation', source: `
import codecs
for base, method, data, changed in ((codecs.BufferedIncrementalEncoder, 'encode', 'abcd', 'changed'), (codecs.BufferedIncrementalDecoder, 'decode', b'abcd', b'changed')):
    events = []
    failure = LookupError('index')
    class Count:
        def __index__(self):
            events.append('index')
            codec.buffer = changed
            if fail:
                raise failure
            return -2
    def operation(self, value, errors, final):
        events.append((value, errors, final))
        self.buffer = changed
        return ('result', Count())
    class Codec(base):
        pass
    setattr(Codec, '_buffer_' + method, operation)
    codec = Codec()
    fail = False
    print(getattr(codec, method)(data, True), codec.getstate(), events)
    codec.reset()
    events.clear()
    fail = True
    try:
        getattr(codec, method)(data)
    except LookupError as error:
        print(error is failure, error.args, codec.getstate(), events)
`},
  {name: 'writer materializes all lines before validating elements and encoding', source: `
import codecs
events = []
failure = ValueError('source')
class Stream:
    def write(self, value):
        events.append(('write', value))
class Writer(codecs.StreamWriter):
    def encode(self, value, errors):
        events.append(('encode', value, errors))
        return value.encode(), 0
writer = Writer(Stream())
def lines(broken):
    events.append('first')
    yield 'A'
    events.append('invalid')
    yield 42
    events.append('last')
    writer.errors = 'replace'
    if broken:
        raise failure
    yield 'B'
for broken in (False, True):
    events.clear()
    try:
        writer.writelines(lines(broken))
    except Exception as error:
        print(type(error).__name__, error.args, error is failure, events, writer.errors)
`},
  {name: 'seek comparison and reset failures preserve exact ordering', source: `
import codecs
events = []
failure = ValueError('reset')
class Position:
    def __init__(self, name, truth):
        self.name = name
        self.truth = truth
    def __eq__(self, other):
        events.append((self.name, 'eq', other))
        return self
    def __bool__(self):
        events.append((self.name, 'bool'))
        return self.truth
class Stream:
    def seek(self, offset, whence):
        events.append('stream.seek')
class Reader:
    def __init__(self, stream, errors):
        pass
    def reset(self):
        events.append('reader.reset')
        if fail:
            raise failure
class Writer(codecs.StreamWriter):
    def reset(self):
        events.append('writer.reset')
        if fail:
            raise failure
for paired in (False, True):
    for fail in (False, True):
        for truth in (False, True):
            events.clear()
            stream = Stream()
            wrapper = codecs.StreamReaderWriter(stream, Reader, Writer) if paired else Writer(stream)
            try:
                result = wrapper.seek(Position('offset', True), Position('whence', truth))
                print(paired, fail, truth, result, events)
            except ValueError as error:
                print(paired, fail, truth, error is failure, events)
`},
  {name: 'reader cached line aliasing and keepends failure mutation', source: `
import codecs
class Stream:
    def read(self, *args):
        raise AssertionError('cached reads must not reach stream')
reader = codecs.getreader('utf8')(Stream())
failure = ValueError('keepends')
class Keep:
    def __bool__(self):
        raise failure
for cache in (['a\\n'], ['a\\n', 'b\\n'], ['a\\n', 'b\\n', 'c']):
    reader.charbuffer = 'old'
    reader.linebuffer = cache
    try:
        reader.readline(keepends=Keep())
    except ValueError as error:
        print(error is failure, cache, reader.linebuffer, reader.linebuffer is cache, reader.charbuffer)
reader.linebuffer = ['a', 17, 'b']
cache = reader.linebuffer
reader.charbuffer = 'old'
try:
    reader.read(0)
except TypeError as error:
    print(error.args, reader.linebuffer is cache, cache, reader.charbuffer)
`},
  {name: 'iterencode and iterdecode throw and close do not finalize nested source', source: `
import codecs
for decoding in (False, True):
    events = []
    failure = ValueError('injected')
    class Codec:
        def __init__(self, errors):
            events.append(('init', errors))
        def encode(self, data, final=False):
            events.append(('convert', data, final))
            return data
        decode = encode
    def source():
        try:
            yield b'A' if decoding else 'A'
            events.append('resumed')
            yield b'B' if decoding else 'B'
        finally:
            events.append('source.finally')
    factory = codecs.iterdecode if decoding else codecs.iterencode
    if decoding:
        codecs.getincrementaldecoder = lambda name: Codec
    else:
        codecs.getincrementalencoder = lambda name: Codec
    for close in (False, True):
        events.clear()
        nested = source()
        iterator = factory(nested, 'unused')
        print(next(iterator))
        try:
            print(iterator.close() if close else iterator.throw(failure))
        except ValueError as error:
            print(error is failure)
        print(events, list(iterator))
        print(next(nested), events)
        nested.close()
        print(events)
`},
  {name: 'recoder resolves writer after decoder mutation and preserves joined bytes', source: `
import codecs
events = []
class Reader:
    def __init__(self, stream, errors):
        pass
class Writer(Reader):
    def write(self, value):
        events.append(('original', value))
class Replacement:
    def write(self, value):
        events.append(('replacement', value))
        return marker
marker = []
def decode(data, errors):
    events.append(('decode', data, errors))
    recoder.writer = Replacement()
    return ('converted', object())
recoder = codecs.StreamRecoder(None, None, decode, Reader, Writer)
def lines():
    yield b'A'
    recoder.errors = 'changed'
    yield b'B'
print(recoder.writelines(lines()) is marker, events)
`}
] as const;
