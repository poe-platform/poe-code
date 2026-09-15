export const codecRot13UndefinedCases = [
  {name: 'registry aliases and module identity', source: `
import codecs
import encodings.rot_13 as rot
import encodings.undefined as undefined
for name in ('rot13', 'rot-13', 'ROT 13', 'rot_13'):
    info = codecs.lookup(name)
    print(info.name, info._is_text_encoding, info.incrementalencoder is rot.IncrementalEncoder)
info = codecs.lookup('undefined')
print(info.name, info._is_text_encoding, info.incrementaldecoder is undefined.IncrementalDecoder)
print(rot.__name__, undefined.__package__)
print(len(rot.rot13_map), rot.rot13_map[65], rot.rot13_map[233])
`},
  {name: 'ROT13 full byte range and supplementary scalars', source: `
import codecs
text = ''.join(chr(i) for i in range(256)) + '\\ud800\\udcff🐍'
encoded = codecs.encode(text, 'rot13')
print(ascii(encoded))
print(codecs.decode(encoded, 'rot13') == text)
for errors in ('strict', 'ignore', 'replace', 'custom'):
    print(codecs.encode('Hello, 世界!', 'rot13', errors))
`},
  {name: 'ROT13 shared mutable mapping and session cache', source: `
import codecs
import encodings.rot_13 as rot
info = codecs.lookup('rot13')
encoder = codecs.getincrementalencoder('rot13')()
decoder = codecs.getincrementaldecoder('rot13')()
rot.rot13_map[65] = 'expanded'
rot.rot13_map[66] = None
print(info.encode('ABC'), info.decode('ABC'))
print(encoder.encode('ABC'), decoder.decode('ABC'))
rot.rot13_map = {65: 90}
print(info.encode('ABC'), encoder.encode('ABC'))
`},
  {name: 'ROT13 subtype evaluation order and callback failures', source: `
import codecs
import encodings.rot_13 as rot
events = []
class Text(str):
    def __len__(self):
        events.append('len')
        return 17
    def translate(self, mapping):
        raise AssertionError('overridden translate')
class Mapping:
    def __getitem__(self, key):
        events.append(key)
        return key
rot.rot13_map = Mapping()
print(rot.Codec().encode(Text('AB')))
print(events)
failure = ValueError('mapping failed')
class Bad:
    def __getitem__(self, key):
        raise failure
rot.rot13_map = Bad()
try:
    codecs.encode('A', 'rot13')
except ValueError as error:
    print(error is failure, error.__notes__)
`},
  {name: 'ROT13 incremental state and arbitrary final values', source: `
import codecs
for factory in (codecs.getincrementalencoder('rot13'), codecs.getincrementaldecoder('rot13')):
    codec = factory('custom')
    method = codec.encode if hasattr(codec, 'encode') else codec.decode
    print(codec.errors, codec.getstate())
    print(method('Ab', object()), method('🐍Z', False), method('', True))
    print(codec.setstate(object()), codec.getstate(), codec.reset(), codec.getstate())
`},
  {name: 'ROT13 domain errors and encoder text rejection', source: `
import codecs
import encodings.rot_13 as rot
for operation in (rot.Codec().encode, rot.Codec().decode, rot.IncrementalEncoder().encode, rot.IncrementalDecoder().decode):
    for value in (b'A', 1, None):
        try:
            operation(value)
        except TypeError as error:
            print(type(error).__name__, str(error))
for operation in (lambda: 'A'.encode('rot13'), lambda: bytes('A', 'rot13')):
    try:
        operation()
    except LookupError as error:
        print(str(error))
`},
  {name: 'ROT13 writers filters and failure order', source: `
import codecs
import encodings.rot_13 as rot
events = []
class Stream:
    def write(self, value):
        events.append(value)
        return 42
    def read(self):
        return 'Hello'
stream = Stream()
writer = codecs.getwriter('rot13')(stream)
print(writer.write('ABC'), writer.writelines(['Ab', 'Cd']))
print(rot.rot13(stream, stream), events)
reader = codecs.getreader('rot13')(stream)
print(reader.decode('Uryyb'))
`},
  {name: 'undefined transformations always fail including empty input', source: `
import codecs
import encodings.undefined as module
for operation in (module.Codec().encode, module.Codec().decode, module.IncrementalEncoder().encode, module.IncrementalDecoder().decode):
    for value in ('', b'', None, 'A'):
        try:
            operation(value, object())
        except UnicodeError as error:
            print(type(error).__name__, error.args)
for operation in (codecs.encode, codecs.decode):
    try:
        operation('', 'undefined', 'ignore')
    except UnicodeError as error:
        print(str(error), error.__notes__)
`},
  {name: 'stream reads preserve text-domain failures and empty reads', source: `
import codecs
class Stream:
    def __init__(self, data):
        self.data = data
        self.calls = []
    def read(self, size=-1):
        self.calls.append(size)
        value = self.data
        self.data = b''
        return value
for encoding in ('rot13', 'undefined'):
    for data in ('ABC', b'ABC', b''):
        stream = Stream(data)
        reader = codecs.getreader(encoding)(stream)
        try:
            print(reader.read())
        except (TypeError, UnicodeError) as error:
            print(type(error).__name__, str(error))
        print(stream.calls, reader.bytebuffer, reader.charbuffer)
`},
  {name: 'ROT13 mapping invalid values and deletion order', source: `
import codecs
import encodings.rot_13 as rot
for value in (0x110000, -1, b'A', object(), '', None):
    rot.rot13_map = {65: value}
    try:
        print(codecs.encode('ABA', 'rot13'))
    except (TypeError, ValueError) as error:
        print(type(error).__name__, str(error), error.__notes__)
`},
  {name: 'undefined incremental and stream construction state', source: `
import codecs
for factory in (codecs.getincrementalencoder('undefined'), codecs.getincrementaldecoder('undefined')):
    codec = factory('ignored')
    print(codec.errors, codec.getstate(), codec.reset(), codec.setstate(object()), codec.getstate())
class Stream:
    def write(self, data):
        raise AssertionError('write happened')
for factory in (codecs.getreader('undefined'), codecs.getwriter('undefined')):
    stream = Stream()
    codec = factory(stream, 'ignored')
    print(codec.stream is stream, codec.errors)
    operation = codec.encode if hasattr(codec, 'encode') else codec.decode
    try:
        operation('')
    except UnicodeError as error:
        print(str(error))
`}
];

export const codecRot13CancellationCases = [
  {name: 'translation mapping', source: `
import codecs
import encodings.rot_13 as rot
class Mapping:
    def __getitem__(self, key):
        input()
        raise ValueError('after cancellation')
rot.rot13_map = Mapping()
try:
    codecs.encode('A', 'rot13')
except BaseException:
    print('recovered')
`},
  {name: 'consumed length', source: `
import codecs
class Text(str):
    def __len__(self):
        input()
        return 1
try:
    codecs.encode(Text('A'), 'rot13')
except BaseException:
    print('recovered')
`},
  {name: 'writer callback', source: `
import codecs
class Stream:
    def write(self, value):
        input()
        raise ValueError('after cancellation')
try:
    codecs.getwriter('rot13')(Stream()).write('A')
except BaseException:
    print('recovered')
`},
  {name: 'reader callback', source: `
import codecs
class Stream:
    def read(self, size=-1):
        input()
        return b'A'
try:
    codecs.getreader('rot13')(Stream()).read()
except BaseException:
    print('recovered')
`},
  {name: 'filter callback', source: `
import encodings.rot_13 as rot
class Stream:
    def read(self):
        input()
        return 'A'
    def write(self, value):
        print('wrote after cancellation')
try:
    rot.rot13(Stream(), Stream())
except BaseException:
    print('recovered')
`}
];
