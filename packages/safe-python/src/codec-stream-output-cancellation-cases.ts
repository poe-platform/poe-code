/** Fatal cancellation inside real guest write protocols must never be caught. */
export const codecStreamOutputCancellationCases = [
  {name: 'writer.write', operation: "codecs.getwriter('utf8')(stream).write('é')"},
  {name: 'writer.writelines', operation: "codecs.getwriter('utf8')(stream).writelines(['é', '🐍'])"},
  {name: 'paired.write', operation: "codecs.StreamReaderWriter(stream, codecs.getreader('utf8'), codecs.getwriter('utf8')).write('é')"},
  {name: 'recoder.write', operation: "codecs.StreamRecoder(stream, codecs.latin_1_encode, codecs.latin_1_decode, codecs.getreader('utf8'), codecs.getwriter('utf8')).write(b'\\xe9')"}
].map(({name, operation}) => ({name, source: `
import codecs
class Stream:
    def write(self, data):
        print(data.hex())
        raise AssertionError('write resumed')
stream = Stream()
try:
    ${operation}
except BaseException:
    raise AssertionError('cancellation was caught')
raise AssertionError('operation resumed')
`}));
