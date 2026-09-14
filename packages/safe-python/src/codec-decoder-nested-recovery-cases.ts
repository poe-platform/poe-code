/** Complete user programs shared with the external pinned differential oracle. */
export const codecDecoderNestedRecoveryCases = [
  "ascii", "cp1252", "utf-8", "utf-8-sig", "utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be", "utf-7"
].map(encoding => ({encoding, source: `import codecs
encoding = '${encoding}'
factory = codecs.getincrementaldecoder(encoding)
if encoding == 'ascii':
    data = b'\\xffA\\xffZ'
elif encoding == 'cp1252':
    data = b'\\x81A\\x81Z'
elif encoding == 'utf-7':
    data = b'\\xffA\\xffZ'
else:
    data = codecs.encode('\\ud800A\\udfffZ', encoding, 'surrogatepass')
valid = codecs.encode('AZ', encoding)
failure = ValueError('nested recovery failed')
for fail in (False, True):
    decoder = factory('nested-recovery')
    retained = []
    events = []
    def recover(error):
        if retained:
            assert error is retained[0]
        else:
            retained.append(error)
        events.append(('fault', error.object, error.start, error.end, decoder.getstate()))
        decoder.reset()
        decoder.errors = 'replace'
        first = decoder.decode(valid[:1])
        assert input() == 'continue'
        second = decoder.decode(valid[1:], True)
        events.append(('nested', first, second, decoder.getstate()))
        decoder.errors = 'missing-after-nested'
        if fail:
            raise failure
        return ('?', error.end - len(error.object) if error.end < len(error.object) else error.end)
    codecs.register_error('nested-recovery', recover)
    split = 0 if encoding in ('ascii', 'cp1252', 'utf-7') else 1
    print('prefix', decoder.decode(data[:split]))
    try:
        print('outer', decoder.decode(data[split:], True))
    except ValueError as error:
        assert error is failure
        print('failure', error.args)
    print('state', decoder.getstate(), decoder.errors)
    print('events', events)
    decoder.reset()
    decoder.errors = 'replace'
    print('retry', decoder.decode(valid, True), decoder.getstate())
` }));
