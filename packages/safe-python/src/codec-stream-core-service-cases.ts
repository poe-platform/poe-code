/** Unchanged programs for guest execution and the pinned external oracle.
 * Hex lines cross explicit text services; byte storage and stream protocols
 * belong to guest objects, including one-byte short reads and seeking. */
export const codecStreamCoreServiceCases = ['ascii', 'latin-1', 'utf-8'].map(encoding => ({
  name: `${encoding} paired and recoded short-read streams`,
  input: '410ac3a90a5a0a\n',
  source: `
import codecs
class Stream:
    def __init__(self):
        self.data = bytes.fromhex(input())
        self.position = 0
        self.closed = False
    def read(self, size=-1):
        count = 0 if size == 0 else 1
        result = self.data[self.position:self.position + count]
        self.position += len(result)
        return result
    def write(self, data):
        print('write', data.hex())
        return len(data)
    def tell(self):
        return self.position
    def seek(self, offset, whence=0):
        if whence == 0:
            self.position = offset
        elif whence == 1:
            self.position += offset
        else:
            self.position = len(self.data) + offset
        return self.position
    def close(self):
        self.closed = True
stream = Stream()
reader = codecs.getreader('${encoding}')
writer = codecs.getwriter('${encoding}')
paired = codecs.StreamReaderWriter(stream, reader, writer, 'replace')
print(paired.read(0), paired.tell())
print(repr(paired.readline()), paired.tell())
print(paired.readlines(1, False), paired.tell())
print(paired.seek(0), paired.tell())
print(list(paired), paired.tell())
print(paired.reset(), paired.reader.bytebuffer)
print(paired.write('Aé'), paired.writelines(['Z', '\\n']))
recoder = codecs.StreamRecoder(stream, codecs.utf_8_encode, codecs.utf_8_decode, reader, writer, 'replace')
print(recoder.seek(0), recoder.tell())
print(recoder.readline().hex(), recoder.tell())
print([line.hex() for line in recoder.readlines()], recoder.tell())
print(recoder.seek(0), recoder.read(2).hex())
print(recoder.reset())
print(recoder.write(b'A\\xc3\\xa9'), recoder.writelines([b'Z', b'\\n']))
with recoder as active:
    print(active is recoder, stream.closed)
print(stream.closed)
`
}));
