/** Public programs shared verbatim by interpreter tests and the external oracle. */
export const codecTextFlagCases = [
  "'input'.encode('flag-probe')",
  "bytes('input', 'flag-probe')",
  "codecs.encode('input', 'flag-probe')",
  "codecs.decode('input', 'flag-probe')"
].flatMap(expression => ["true", "false", "missing", "descriptor_failure", "truth_failure", "invalid_truth"].map(mode => ({
  name: `${expression}: ${mode}`,
  source: `
import codecs
events = []
failure = AttributeError('retained failure')
class Flag:
    def __bool__(self):
        events.append('truth')
        if '${mode}' == 'truth_failure':
            raise failure
        if '${mode}' == 'invalid_truth':
            return 1
        return '${mode}' != 'false'
class Info(codecs.CodecInfo):
    @property
    def _is_text_encoding(self):
        events.append('flag')
        if '${mode}' == 'missing':
            raise failure
        if '${mode}' == 'descriptor_failure':
            raise ValueError('descriptor failure')
        return Flag()
    def __len__(self):
        raise AssertionError('virtual tuple length')
    def __getitem__(self, index):
        raise AssertionError('virtual tuple item')
def original(*args):
    events.append(('original', args))
    return (b'result', object())
def replacement(*args):
    raise AssertionError('native dispatch used mutable attribute')
info = Info(original, original, name='flag-probe')
info.encode = replacement
info.decode = replacement
def search(name):
    events.append(('search', name))
    return info if name == 'flag_probe' else None
codecs.register(search)
assert codecs.getencoder('flag-probe') is replacement
assert codecs.getdecoder('flag-probe') is replacement
events.clear()
for attempt in range(2):
    try:
        print('result', ${expression})
    except Exception as error:
        print(type(error).__name__, error.args, error is failure, getattr(error, '__notes__', None))
print(events)
`
})));

export const codecTextFlagServiceCases = ["'outer'.encode('flag-probe')", "bytes('outer', 'flag-probe')"].flatMap(expression =>
  ["descriptor", "truth"].flatMap(stage => [false, true].map(raises => ({
    name: `${expression}: ${stage} service raises=${raises}`,
    source: `
import codecs
events = []
failure = ValueError('retained failure')
def alternate(*args):
    events.append(('alternate', args))
    return (b'alternate', None)
replacement = codecs.CodecInfo(alternate, None, name='replacement')
def new_search(name):
    events.append(('new search', name))
    return replacement if name == 'flag_probe' else None
def checkpoint():
    codecs.unregister(search)
    codecs.register(new_search)
    events.append(('input', input()))
    assert codecs.encode('nested', 'flag-probe') == b'alternate'
    if ${raises ? "True" : "False"}:
        raise failure
    return True
class Flag:
    def __bool__(self):
        events.append('truth')
        return checkpoint()
class Info(codecs.CodecInfo):
    @property
    def _is_text_encoding(self):
        events.append('flag')
        if '${stage}' == 'descriptor':
            return checkpoint()
        return Flag()
def original(*args):
    events.append(('original', args))
    return (b'original', None)
info = Info(original, None, name='original')
def search(name):
    events.append(('search', name))
    return info if name == 'flag_probe' else None
codecs.register(search)
try:
    print('result', ${expression})
except ValueError as error:
    print(error is failure, error.args, getattr(error, '__notes__', None))
assert codecs.lookup('flag-probe') is replacement
print('next', ${expression})
print(events)
`
  })))
);
