/** Unchanged guest programs shared with the external pinned oracle. */
export const codecDecoderObjectTransferCases: {name: string; source: string}[] = [];
const encodings=[['utf-8','b"\\xff"'],['utf-8-sig','b"\\xff"'],['utf-7','b"\\xff"'],['utf-16-le','b"\\x00\\xd8"'],['utf-16-be','b"\\xd8\\x00"'],['utf-32-le','b"\\x00\\x00\\x11\\x00"'],['utf-32-be','b"\\x00\\x11\\x00\\x00"']];
for(const [encoding,bad] of encodings)for(const action of ['keep','reset','setstate'])for(const fail of [false,true]){
 const source=`import codecs
encoding = '${encoding}'
factory = codecs.getincrementaldecoder(encoding)
replacement = codecs.encode('Z', encoding)
data = codecs.encode('A', encoding) + ${bad}
failure = ValueError('resume failed')
for split in range(len(data) + 1):
    events = []
    decoder = factory('object-transfer')
    class Position:
        def __index__(self):
            events.append(('index', decoder.getstate()))
            error.object = replacement
            ${action==='reset'?'decoder.reset()':action==='setstate'?"decoder.setstate((b'Q', 0))":'pass'}
            ${fail?'raise failure':'return -len(replacement)'}
    def handler(caught):
        global error
        error = caught
        events.append(('handler', caught.object, caught.start, caught.end, caught.reason, decoder.getstate()))
        return ('!', Position())
    codecs.register_error('object-transfer', handler)
    try:
        first = decoder.decode(data[:split])
        print('first', split, repr(first), decoder.getstate())
        print('last', repr(decoder.decode(data[split:], True)), decoder.getstate())
    except BaseException as caught:
        print('failure', split, type(caught).__name__, caught.args, caught is failure, decoder.getstate())
    print('events', events)
    decoder.reset()
    decoder.errors = 'strict'
    print('reset', repr(decoder.decode(replacement, True)), decoder.getstate())
`;
 codecDecoderObjectTransferCases.push({name:`${encoding}; ${action}; ${fail?'raise':'negative resume'}`,source});
}
