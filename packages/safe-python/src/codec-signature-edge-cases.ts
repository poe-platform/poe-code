/** Run unchanged against the real interpreter and pinned external oracle. */
export const codecSignatureEdgeCases = [
  {
    name: 'Pinned BOM values and alias identity',
    source: `
import codecs
for name in ('BOM_UTF8', 'BOM_LE', 'BOM_UTF16_LE', 'BOM_BE', 'BOM_UTF16_BE', 'BOM_UTF32_LE', 'BOM_UTF32_BE', 'BOM', 'BOM_UTF16', 'BOM_UTF32', 'BOM32_LE', 'BOM32_BE', 'BOM64_LE', 'BOM64_BE'):
    value = getattr(codecs, name)
    print(name, type(value).__name__, value)
assert codecs.BOM is codecs.BOM_UTF16 is codecs.BOM_LE is codecs.BOM_UTF16_LE is codecs.BOM32_LE
assert codecs.BOM_BE is codecs.BOM_UTF16_BE is codecs.BOM32_BE
assert codecs.BOM_UTF32 is codecs.BOM_UTF32_LE is codecs.BOM64_LE
assert codecs.BOM_UTF32_BE is codecs.BOM64_BE
`
  },
  {
    name: 'UTF-8 signature partial BOM finalization and decoder recovery',
    source: `
import codecs
for data in (b'', b'\\xef', b'\\xef\\xbb', b'\\xef\\xbb\\xbf', b'\\xefA', b'\\xef\\xbbA', b'\\xef\\xbb\\xbf\\xff'):
    for policy in ('strict', 'ignore', 'replace', 'surrogateescape'):
        decoder = codecs.getincrementaldecoder('utf-8-sig')(policy)
        for byte in data:
            try:
                print('piece', repr(decoder.decode(bytes([byte]))), decoder.getstate())
            except UnicodeDecodeError as error:
                print(error.args, decoder.getstate())
        try:
            print('final', repr(decoder.decode(b'', True)), decoder.getstate())
        except UnicodeDecodeError as error:
            print(error.args, decoder.getstate())
        decoder.reset()
        print('reset', decoder.getstate())
`
  },
  {
    name: 'UTF-8 signature failed first encoding consumes first-write state',
    source: `
import codecs
encoder = codecs.getincrementalencoder('utf-8-sig')()
try:
    encoder.encode('\\ud800')
except UnicodeEncodeError as error:
    print(error.args, encoder.getstate())
print(encoder.encode('A'))
encoder.reset()
print(encoder.encode(''), encoder.getstate(), encoder.encode('B'))
class Stream:
    def write(self, data):
        print('write', data)
writer = codecs.getwriter('utf-8-sig')(Stream())
try:
    writer.write('\\ud800')
except UnicodeEncodeError as error:
    print(error.args, writer.encode is codecs.utf_8_encode)
writer.write('A')
writer.reset()
writer.write('B')
writer.write('C')
`
  },
  {
    name: 'UTF-8 signature reader method replacement and reset',
    source: `
import codecs
class Stream:
    def read(self, size=-1):
        return b''
reader = codecs.getreader('utf-8-sig')(Stream())
for data in (b'\\xef', b'\\xef\\xbb', codecs.BOM_UTF8, codecs.BOM_UTF8 + b'A'):
    print(reader.decode(data), 'decode' in reader.__dict__)
    reader.reset()
    print('reset', 'decode' in reader.__dict__)
try:
    reader.decode(codecs.BOM_UTF8 + b'\\xff')
except UnicodeDecodeError as error:
    print(error.args, reader.decode is codecs.utf_8_decode)
print(reader.decode(codecs.BOM_UTF8 + b'A'))
reader.reset()
print(reader.decode(codecs.BOM_UTF8 + b'A'))
`
  }
];
