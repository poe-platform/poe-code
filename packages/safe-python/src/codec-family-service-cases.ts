import {codecAdapterFamilies} from './codec-family-adapter-cases.js';

/** Execute with explicit real line-input/output services for adapter evidence. */
export const codecFamilyServiceCases = codecAdapterFamilies.map(encoding => ({
  name: encoding,
  source: `
import codecs
class Stream:
    def __init__(self):
        self.buffer = b''
        self.encoder = codecs.getincrementalencoder('${encoding}')()
    def read(self, size=-1):
        if not self.buffer:
            try:
                line = input() + '\\n'
            except EOFError:
                return b''
            self.buffer = self.encoder.encode(line)
        count = 1 if size != 0 else 0
        result = self.buffer[:count]
        self.buffer = self.buffer[count:]
        return result
    def write(self, data):
        print(data.hex())
reader = codecs.getreader('${encoding}')(Stream())
writer = codecs.getwriter('${encoding}')(Stream())
assert reader.readline() == 'é\\n'
writer.write('é\\n')
assert reader.readline() == 'A\\n'
writer.writelines(['A', '\\n'])
assert reader.read() == ''
`
}));
