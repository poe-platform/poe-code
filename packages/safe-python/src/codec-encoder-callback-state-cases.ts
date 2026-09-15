/** Public guest programs, also executed unchanged by the pinned external oracle. */
export const codecEncoderCallbackStateCases = [
  'ascii', 'latin-1', 'utf-8', 'utf-8-sig', 'utf-16', 'utf-16-le', 'utf-16-be',
  'utf-32', 'utf-32-le', 'utf-32-be'
].flatMap(encoding => ['keep', 'reset', 'setstate', 'nested'].flatMap(action =>
  [false, true].map(fail => ({
    name: `${encoding}; ${action}; ${fail ? 'index failure' : 'negative resume'}`,
    source: `import codecs
factory = codecs.getincrementalencoder('${encoding}')
failure = ValueError('resume failed')
source = 'A\\ud800B\\udfffZ'
for warm in (False, True):
    events = []
    retained = []
    encoder = factory('encoder-state')
    if warm:
        print('warm', encoder.encode('W'))
    def next_handler(error):
        events.append(('next', error.object, error.start, error.end))
        return ('#', error.end)
    class Position:
        def __init__(self, error):
            self.error = error
        def __index__(self):
            error = self.error
            events.append(('index', encoder.getstate()))
            position = error.end - len(source)
            error.object = 'changed'
            ${action === 'reset' ? 'encoder.reset()' : action === 'setstate' ? 'encoder.setstate(0)' : action === 'nested' ? "events.append(('nested', encoder.encode('N'), encoder.getstate()))" : 'pass'}
            ${fail ? 'raise failure' : 'return position'}
    def handler(error):
        events.append(('handler', error.object, error.start, error.end, error.reason, encoder.getstate()))
        if retained:
            assert error is retained[0]
        else:
            retained.append(error)
        codecs.register_error('encoder-state', next_handler)
        return ('!', Position(error))
    codecs.register_error('encoder-state', handler)
    try:
        print('result', encoder.encode(source, True), encoder.getstate())
    except BaseException as error:
        print('failure', type(error).__name__, error.args, error is failure, encoder.getstate())
    print('events', events)
    print('following', encoder.encode('T\\ud800', True), encoder.getstate())
    encoder.reset()
    encoder.errors = 'strict'
    print('reset', encoder.encode('R', True), encoder.getstate())
`
  }))));
