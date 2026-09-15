export const codecUtf8PrefixUserSource = String.raw`
import codecs
samples = [b'\x00\x7f', b'\xc2\x80', b'\xdf\xbf', b'\xe0\x80', b'\xe0\xa0', b'\xed\x9f', b'\xed\xa0', b'\xed\xbf', b'\xf0\x90', b'\xf4\x8f', b'\xf4\x90', b'\xff\x80']
for policy in ['strict', 'ignore', 'replace', 'surrogateescape', 'surrogatepass', 'backslashreplace']:
    for data in samples:
        for split in range(3):
            decoder = codecs.getincrementaldecoder('utf-8')(policy)
            print(policy, data, split)
            for chunk, final in [(data[:split], False), (b'', False), (data[split:], True)]:
                try:
                    print('decoded', repr(decoder.decode(chunk, final)))
                except UnicodeDecodeError as error:
                    print('fault', error.args, error.object, error.start, error.end, error.reason)
                print('state', decoder.getstate())
            decoder.errors = 'replace'
            print('flush', repr(decoder.decode(b'', True)), decoder.getstate())
            decoder.reset()
            print('reset', decoder.getstate(), decoder.errors)

failure = ValueError('retained recovery failure')
fail = False
events = []
def recover(error):
    events.append((error.object, error.start, error.end, error.reason))
    print('recover', events[-1])
    print('input', input('resume: '))
    if fail:
        raise failure
    return ('?', error.end - len(error.object))
codecs.register_error('prefix-user-recovery', recover)
decoder = codecs.getincrementaldecoder('utf8')('prefix-user-recovery')
print('pending', repr(decoder.decode(b'\xed\xa0')), decoder.getstate())
print('repaired', repr(decoder.decode(b'\x80A', True)), decoder.getstate())
fail = True
try:
    decoder.decode(b'\xffB', True)
except ValueError as caught:
    print('same failure', caught is failure, caught.args, decoder.getstate())
decoder.reset()
decoder.errors = 'surrogateescape'
print('retry', repr(decoder.decode(b'\xffB', True)), decoder.getstate())
`;
