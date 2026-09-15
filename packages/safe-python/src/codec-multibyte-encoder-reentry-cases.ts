/** Ordinary guest programs retained unchanged for external differential replay. */
export const codecMultibyteEncoderReentryCases = [
  'gb2312', 'gbk', 'euc_jis_2004', 'euc_jisx0213', 'shift_jis_2004', 'shift_jisx0213'
].map(name => ({name, source: `import codecs
factory = codecs.getincrementalencoder('${name}')
failure = ValueError('reentry failed')
def state(text, opaque):
    data = text.encode('utf-8')
    return int.from_bytes(bytes([len(data)]) + data + opaque.to_bytes(8, 'little'), 'little')
for original in ('', 'A', 'か'):
    for installed in ('', 'B', 'か'):
        for action in ('negative', 'raise', 'nested', 'invalid'):
            for final in (False, True):
                events = []
                encoder = factory('multibyte-reentry')
                encoder.setstate(state(original, 42))
                def recover(error):
                    events.append(('error', error.encoding, error.object, error.start, error.end, error.reason, encoder.getstate()))
                    encoder.setstate(state(installed, 99))
                    if action == 'raise':
                        raise failure
                    if action == 'nested':
                        events.append(('nested', encoder.encode('N', False), encoder.getstate()))
                    if action == 'invalid':
                        return (b'?', len(error.object) + 1)
                    return (b'?', error.end - len(error.object))
                codecs.register_error('multibyte-reentry', recover)
                try:
                    outcome = ('ok', encoder.encode('\\ud800か', final))
                except BaseException as error:
                    outcome = ('error', type(error).__name__, error.args, error is failure)
                saved = encoder.getstate()
                restored = factory('strict')
                restored.setstate(saved)
                assert restored.getstate() == saved
                try:
                    following = ('ok', restored.encode('゚Z', True))
                except BaseException as error:
                    following = ('error', type(error).__name__, error.args)
                print(original, installed, action, final, events, outcome, saved, following, restored.getstate())
                restored.reset()
                print('reset', restored.getstate(), restored.encode('A', True))
` }));
