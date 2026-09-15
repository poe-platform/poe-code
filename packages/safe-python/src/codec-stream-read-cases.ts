export const codecStreamReadCases=['ascii','latin1','utf8'].flatMap(encoding=>[1,2,3,64].map(chunk=>({
  name:`${encoding} chunks of ${chunk}`,
  source:`
import codecs
class Stream:
    def __init__(self, data):
        self.data = data
        self.position = 0
        self.calls = []
    def read(self, size=-1):
        self.calls.append(size)
        count = ${chunk} if size < 0 else min(size, ${chunk})
        result = self.data[self.position:self.position + count]
        self.position += len(result)
        return result
for payload in (b'a\\r\\nb\\nlast', b'a\\n\\xff', b'\\xc3\\xa9\\r\\n\\xe2\\x82'):
    for operation, args in (('read', ()), ('read', (0,)), ('read', (1,)), ('read', (2, 1)), ('read', (1, 3)), ('read', (-1, 2, True)), ('readline', ()), ('readline', (1, False)), ('readline', (0,)), ('readlines', (0, False))):
        stream = Stream(payload)
        reader = codecs.getreader('${encoding}')(stream)
        results = []
        for step in range(3):
            try:
                results.append(('ok', getattr(reader, operation)(*args)))
            except UnicodeDecodeError as error:
                results.append(('UnicodeDecodeError', error.encoding, error.object, error.start, error.end, error.reason))
        print(payload, operation, args, results, reader.bytebuffer, reader.charbuffer, reader.linebuffer, stream.position, stream.calls)
`
})));
