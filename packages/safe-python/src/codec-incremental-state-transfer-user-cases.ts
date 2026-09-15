/** Identical guest programs for PythonSession and the pinned external oracle. */
export const codecIncrementalStateTransferUserCases = [
  'utf-8', 'utf-8-sig', 'utf-7', 'utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be',
].flatMap(encoding => ['strict', 'replace', 'surrogatepass'].map(policy => ({
  name: `${encoding}; ${policy}`,
  source: `import codecs
factory = codecs.getincrementaldecoder('${encoding}')
data = '\\ufeffAé😀\\r\\n\\ufeffZ'.encode('${encoding}')
for split in range(len(data) + 1):
    original = factory('${policy}')
    head = original.decode(data[:split])
    saved = original.getstate()
    clone = factory('${policy}')
    print('restore', split, clone.setstate(saved), clone.getstate(), head)
    try:
        print('final', repr(clone.decode(b'', True)))
    except UnicodeError as error:
        print('error', type(error).__name__, error.args, error.object, error.start, error.end, error.reason)
    print('after final', clone.getstate(), saved, original.getstate())
    clone.setstate(saved)
    tail = clone.decode(data[split:], True)
    print('tail', repr(tail), clone.getstate(), original.getstate())
    assert head + tail == '\\ufeffAé😀\\r\\n\\ufeffZ'
    assert original.getstate() == saved
    print('reset', clone.reset(), clone.getstate(), clone.decode(data, True))
    print('original', original.decode(data[split:], True), original.getstate())
encoder_factory = codecs.getincrementalencoder('${encoding}')
encoder = encoder_factory('${policy}')
for text in ('', 'A', '\\ufeff', '😀', ''):
    state = encoder.getstate()
    clone = encoder_factory('${policy}')
    print('encoder restore', state, clone.setstate(state))
    expected = encoder.encode(text, True)
    actual = clone.encode(text, True)
    assert actual == expected
    print('encoder', actual, encoder.getstate(), clone.getstate())
print('encoder reset', encoder.reset(), encoder.getstate(), encoder.encode('', True))
`,
})));
