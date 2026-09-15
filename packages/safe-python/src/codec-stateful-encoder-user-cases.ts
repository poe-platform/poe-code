/** Run unchanged in PythonSession and the external pinned CPython oracle. */
export const codecStatefulEncoderUserCases = [
  "iso2022_jp", "iso2022_jp_1", "iso2022_jp_2", "iso2022_jp_3",
  "iso2022_jp_2004", "iso2022_jp_ext", "iso2022_kr", "hz"
].map(name => ({name, source: `import codecs
factory = codecs.getincrementalencoder('${name}')
failure = ValueError('encoder recovery failed')
for action in ('keep', 'reset', 'raise'):
    events = []
    encoder = factory('stateful-user')
    def recover(error):
        events.append((error.encoding, error.object, error.start, error.end, error.reason, encoder.getstate()))
        assert input() == 'ready'
        if action == 'reset':
            encoder.reset()
        if action == 'raise':
            raise failure
        return ('?', error.end - len(error.object) if error.end < len(error.object) else error.end)
    codecs.register_error('stateful-user', recover)
    for part, final in [('一', False), ('か', False), ('゚', False), ('\\ud800Z', False), ('', True), ('A~', True)]:
        try:
            print('encoded', encoder.encode(part, final))
        except ValueError as error:
            assert error is failure
            print('failure', type(error).__name__, error.args)
        saved = encoder.getstate()
        print('state', saved)
        restored = factory('stateful-user')
        restored.setstate(saved)
        assert restored.getstate() == saved
        encoder = restored
    encoder.reset()
    print('reset', encoder.getstate())
    print('events', action, events)
` }));
