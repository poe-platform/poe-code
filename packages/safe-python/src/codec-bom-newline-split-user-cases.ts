/** Actual Unicode BOMs and CR/LF, independently of the literal-backslash corpus. */
export const codecBomNewlineSplitUserCases = [
  'utf-8', 'utf-8-sig', 'utf-7', 'utf-16-le', 'utf-16-be', 'utf-32-le', 'utf-32-be', 'utf-16', 'utf-32',
].map(encoding => ({
  name: encoding,
  source: String.raw`import codecs
encoding = '${encoding}'
text = '\ufeffAé😀\r\n\ufeffZ'
assert len(text) == 8
assert ord(text[0]) == 65279
assert [ord(character) for character in text[4:7]] == [13, 10, 65279]
data = text.encode(encoding)
print('encoded', data)
for policy in ['strict', 'replace', 'surrogatepass']:
    factory = codecs.getincrementaldecoder(encoding)
    for split in range(len(data) + 1):
        original = factory(policy)
        head = original.decode(data[:split])
        saved = original.getstate()
        clone = factory(policy)
        clone.setstate(saved)
        try:
            print('empty final', policy, split, repr(clone.decode(b'', True)))
        except UnicodeError as error:
            print('failure', policy, split, type(error).__name__, error.args, error.object, error.start, error.end, error.reason)
        print('after final', clone.getstate(), original.getstate(), saved)
        clone.setstate(saved)
        tail = clone.decode(data[split:], True)
        assert head + tail == text
        assert original.getstate() == saved
        assert head + original.decode(data[split:], True) == text
        print('restored', repr(head), repr(tail), clone.getstate(), original.getstate())
        clone.reset()
        assert clone.decode(data, True) == text
    encoder = codecs.getincrementalencoder(encoding)(policy)
    chunks = []
    for index in range(len(text)):
        state = encoder.getstate()
        clone = codecs.getincrementalencoder(encoding)(policy)
        clone.setstate(state)
        chunk = encoder.encode(text[index], index == len(text) - 1)
        assert clone.encode(text[index], index == len(text) - 1) == chunk
        assert clone.getstate() == encoder.getstate()
        chunks.append(chunk)
        print('encoder', policy, index, chunk, encoder.getstate())
    assert b''.join(chunks).decode(encoding) == text
    encoder.reset()
    assert encoder.encode(text, True) == data
`,
}));
