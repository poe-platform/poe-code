export const codecAdapterFamilies = ['utf_7', 'utf_16_le', 'utf_16_be', 'utf_32_le', 'utf_32_be', 'unicode_escape', 'raw_unicode_escape', 'charmap', 'utf_8_sig'];

/** These programs run unchanged in the guest and pinned external oracle. */
export const codecFamilyAdapterCases = codecAdapterFamilies.flatMap(encoding => [
  {
    name: `${encoding}: state validation and finalization failures`,
    source: `
import codecs
info = codecs.lookup('${encoding}')
for state in (None, 1, (), (b'A',), (b'A', -1), ('A', 0), [b'A', 42]):
    for factory in (info.incrementalencoder, info.incrementaldecoder):
        instance = factory()
        try:
            print('setstate', state, instance.setstate(state), instance.getstate())
        except Exception as error:
            print('setstate', state, type(error).__name__, error.args)
for data in (b'\\xff', b'+', b'+A', b'\\\\u', b'\\x00\\xd8', b'\\x00\\xd8\\x00\\x00'):
    decoder = info.incrementaldecoder()
    for final in (False, True):
        try:
            print(data, final, repr(decoder.decode(data if not final else b'', final)), decoder.getstate())
        except Exception as error:
            print(data, final, type(error).__name__, error.args, decoder.getstate())
    decoder.reset()
    print('reset', decoder.getstate())
`
  },
  {
    name: `${encoding}: class and function inventory`,
    source: `
module = __import__('encodings.${encoding}', fromlist=['*'])
print(module.__doc__)
for name in ('Codec', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamReader', 'StreamWriter'):
    if not hasattr(module, name):
        continue
    cls = getattr(module, name)
    print(list(cls.__dict__))
    print(cls.__module__, cls.__qualname__, cls.__firstlineno__, cls.__static_attributes__, cls.__doc__)
    for name, member in cls.__dict__.items():
        print(name, type(member).__name__)
        if type(member).__name__ == 'function':
            code = member.__code__
            print(member.__name__, member.__qualname__, member.__module__, member.__doc__, member.__defaults__, member.__kwdefaults__, member.__annotations__)
            print(code.co_argcount, code.co_posonlyargcount, code.co_kwonlyargcount, code.co_varnames, code.co_firstlineno, code.co_filename, code.co_flags, member.__annotate__)
        elif type(member).__name__ == 'getset_descriptor':
            print(member.__name__, member.__qualname__, member.__objclass__ is cls, member.__doc__)
for name in ('encode', 'decode', 'getregentry'):
    if hasattr(module, name):
        member = getattr(module, name)
        print(name, type(member).__name__, member.__name__, member.__module__, member.__doc__)
        if type(member).__name__ == 'function':
            code = member.__code__
            print(member.__defaults__, member.__kwdefaults__, member.__annotations__, code.co_firstlineno, code.co_filename)
`
  },
  ...['strict', 'ignore', 'replace', 'surrogatepass', 'backslashreplace'].map(errors => ({
    name: `${encoding}/${errors}: split input and state restoration`,
    source: `
import codecs
module = __import__('encodings.${encoding}', fromlist=['*'])
info = codecs.lookup('${encoding}')
assert info.incrementaldecoder is module.IncrementalDecoder
assert info.incrementalencoder is module.IncrementalEncoder
for text in ('', 'A', 'é', 'AéZ', '+\\\\', '\\ud800', '𝄞'):
    for errors in ('${errors}',):
        try:
            encoded = info.encode(text, errors)[0]
        except Exception as error:
            print(repr(text), errors, type(error).__name__, error.args)
            continue
        print(repr(text), errors, encoded)
        for split in range(len(encoded) + 1):
            decoder = info.incrementaldecoder(errors)
            try:
                first = decoder.decode(encoded[:split])
                state = decoder.getstate()
                second = decoder.decode(encoded[split:], True)
                clone = info.incrementaldecoder(errors)
                clone.setstate(state)
                assert clone.decode(encoded[split:], True) == second
                decoder.reset()
                print(split, repr(first), state, repr(second), decoder.getstate())
            except Exception as error:
                print(split, type(error).__name__, error.args)
        encoder = info.incrementalencoder(errors)
        for character in text:
            print(encoder.encode(character), encoder.getstate())
        print(encoder.encode('', True))
        encoder.reset()
        print(encoder.getstate())
`
  })),
  {
    name: `${encoding}: streams, recovery, and guest failures`,
    source: `
import codecs
info = codecs.lookup('${encoding}')
class Stream:
    def __init__(self, data=b''):
        self.data = data
        self.position = 0
    def read(self, size=-1):
        if size < 0:
            size = len(self.data)
        result = self.data[self.position:self.position + size]
        self.position += len(result)
        return result
    def write(self, data):
        self.data += data
    def seek(self, position, whence=0):
        self.position = position
stream = Stream()
writer = info.streamwriter(stream)
writer.write('Aé')
writer.writelines(['B', 'C'])
writer.reset()
print(stream.data)
reader = info.streamreader(stream)
print(reader.read(1), reader.read(), reader.bytebuffer, reader.charbuffer)
reader.seek(0)
print(reader.read())
events = []
def recover(error):
    events.append((type(error).__name__, error.encoding, error.object, error.start, error.end, error.reason))
    return ('!', -1)
codecs.register_error('adapter_recover', recover)
for data in (b'\\xffA', b'+!A', b'\\\\uQQQQA', b'\\x00\\xd8A', b'\\x00\\xd8\\x00\\x00A'):
    decoder = info.incrementaldecoder('adapter_recover')
    # Returning -1 on a terminal fault would retry the same byte forever.
    # Select a valid suffix for each family so the resume position advances.
    suffix = info.encode('Z')[0]
    def recover(error):
        events.append((type(error).__name__, error.encoding, error.object, error.start, error.end, error.reason))
        return ('!', -len(suffix))
    codecs.register_error('adapter_recover', recover)
    try:
        print(decoder.decode(data + suffix, True), decoder.getstate(), events)
    except Exception as error:
        print(type(error).__name__, error.args)
    events.clear()
failure = ValueError('guest stream failure')
class FailingStream(Stream):
    def write(self, data):
        raise failure
try:
    info.streamwriter(FailingStream()).write('A')
except ValueError as error:
    assert error is failure
else:
    assert False
`
  }
]);
