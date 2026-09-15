/** Guest programs compared unchanged with the pinned external CPython oracle. */
export const codecReentrantCacheAuditCases = [
  {
    name: "outer lookup publishes after nested cache population and unregistration",
    source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
inner = (None, None, None, None)
outer = (False, False, False, False)
active = False
def search(name):
    global active
    events.append(name)
    if active:
        return inner
    active = True
    assert codecs.lookup(name) is inner
    codecs.unregister(search)
    return outer
codecs.register(search)
assert codecs.lookup('Nested-Cache') is outer
assert codecs.lookup('NESTED CACHE') is outer
assert events == ['nested_cache', 'nested_cache']
codecs.unregister(search)
assert codecs.lookup('nested_cache') is outer
codecs.register(search)
codecs.unregister(search)
try:
    codecs.lookup('nested_cache')
except LookupError as error:
    assert error.args == ("no codec search functions registered: can't find encoding",)
else:
    raise AssertionError('cache survived a registered removal')
print('ok')
`,
  },
  {
    name: "error position hooks replace registry handlers without replacing the active handler",
    source: `import codecs
seen = []
def next_handler(error):
    seen.append(('next', error.start))
    return ('N', error.end)
class Position:
    def __init__(self, position):
        self.position = position
    def __index__(self):
        codecs.register_error('reentrant-policy', next_handler)
        return self.position
def first_handler(error):
    seen.append(('first', error.start))
    return ('F', Position(error.end - len(error.object)))
codecs.register_error('reentrant-policy', first_handler)
assert codecs.ascii_decode(b'\\xffA\\xffB', 'reentrant-policy') == ('FAFB', 4)
assert seen == [('first', 0), ('first', 2)]
assert codecs.ascii_decode(b'\\xff', 'reentrant-policy') == ('N', 1)
assert seen == [('first', 0), ('first', 2), ('next', 0)]
print('ok')
`,
  },
  ...Array.from({length: 15}, (_, first) => ({
    name: `UTF8 BOM decoder restores every three-chunk split with surrogate recovery: first=${first}`,
    source: `import codecs
text = 'Aé🐍\\ud800Z'
data = codecs.BOM_UTF8 + text.encode('utf-8', 'surrogatepass')
assert len(data) == 14
for first in [${first}]:
    for second in range(first, len(data) + 1):
        decoder = codecs.getincrementaldecoder('utf-8-sig')('surrogatepass')
        output = decoder.decode(data[:first])
        state = decoder.getstate()
        restored = codecs.getincrementaldecoder('utf-8-sig')('surrogatepass')
        restored.setstate(state)
        middle = decoder.decode(data[first:second])
        assert restored.decode(data[first:second]) == middle
        assert restored.getstate() == decoder.getstate()
        tail = decoder.decode(data[second:], True)
        assert restored.decode(data[second:], True) == tail
        assert output + middle + tail == text
        assert decoder.getstate() == (b'', 0)
        decoder.reset()
        assert decoder.getstate() == (b'', 1)
        assert decoder.decode(data, True) == text
print('ok')
`,
  })),
] as const;
