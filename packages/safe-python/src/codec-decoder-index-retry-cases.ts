/** Complete programs run unchanged in the guest and external pinned oracle. */
export const codecDecoderIndexRetryCases = [
  "utf-8", "utf-8-sig", "utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"
].map(encoding => ({
  encoding,
  source: `import codecs
decoder = codecs.getincrementaldecoder('${encoding}')('index-retry')
data = codecs.encode('\\ud800Z', '${encoding}', 'surrogatepass')
split = ${encoding === "utf-8-sig" ? 4 : 1}
events = []
failure = ValueError('resume failed')
fail = True
class Position:
    def __init__(self, error):
        self.error = error
    def __index__(self):
        events.append(('index', decoder.getstate()))
        decoder.setstate(saved)
        decoder.errors = 'replace'
        try:
            assert input() == 'continue'
            if fail:
                raise failure
            return self.error.end - len(self.error.object)
        finally:
            events.append(('cleanup', decoder.getstate(), decoder.errors))
def handler(error):
    events.append(('handler', error.object, error.start, error.end, error.reason))
    decoder.reset()
    return ('!', Position(error))
codecs.register_error('index-retry', handler)
for attempt in (1, 2):
    decoder.reset()
    decoder.errors = 'index-retry'
    print('prefix', decoder.decode(data[:split]))
    saved = decoder.getstate()
    fail = True
    try:
        decoder.decode(data[split:], True)
    except ValueError as error:
        print('failure', error is failure, error.args, decoder.getstate(), decoder.errors)
    else:
        raise AssertionError('resume failure was swallowed')
    print('saved', saved)
    decoder.setstate(saved)
    decoder.errors = 'index-retry'
    fail = False
    print('retry', decoder.decode(data[split:], True), decoder.getstate(), decoder.errors)
    print('events', events)
    events.clear()
    decoder.reset()
    print('replacement', decoder.decode(data, True), decoder.getstate())
`
}));
