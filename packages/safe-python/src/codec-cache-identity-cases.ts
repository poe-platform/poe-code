/** Public programs replayed unchanged on the pinned external CPython oracle. */
export const codecCacheIdentityCases = [
  {
    name: "duplicate search registrations are removed one identity at a time",
    source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
info = (None, None, None, None)
class Search:
    def __eq__(self, other):
        raise AssertionError('unregister compared search objects')
    def __call__(self, name):
        events.append(name)
        if len(events) % 2 == 0:
            return info
search = Search()
codecs.register(search)
codecs.register(search)
assert codecs.lookup('identity-cache') is info
assert events == ['identity_cache', 'identity_cache']
codecs.unregister(Search())
codecs.unregister(None)
assert codecs.lookup('IDENTITY CACHE') is info
assert len(events) == 2
codecs.unregister(search)
try:
    codecs.lookup('identity-cache')
except LookupError as error:
    assert error.args == ('unknown encoding: identity-cache',)
else:
    raise AssertionError('duplicate registration was not removed exactly once')
assert len(events) == 3
assert codecs.lookup('identity-cache') is info
assert len(events) == 4
codecs.unregister(search)
try:
    codecs.lookup('identity-cache')
except LookupError as error:
    assert error.args == ("no codec search functions registered: can't find encoding",)
else:
    raise AssertionError('last registration or cached result survived')
print('ok')
`,
  },
  {
    name: "malformed search results are uncached and successful tuple payloads stay native",
    source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
class Info(tuple):
    def __len__(self):
        raise AssertionError('virtual tuple length')
    def __getitem__(self, index):
        raise AssertionError('virtual tuple indexing')
info = Info((None, None, None, None))
result = [None, None, None, None]
def search(name):
    events.append(name)
    return result
codecs.register(search)
for malformed in ([None] * 4, (), (None,) * 5, False):
    result = malformed
    try:
        codecs.lookup('tuple-contract')
    except TypeError as error:
        assert error.args == ('codec search functions must return 4-tuples',)
    else:
        raise AssertionError('malformed result accepted')
assert events == ['tuple_contract'] * 4
result = info
assert codecs.lookup('tuple-contract') is info
result = None
assert codecs.lookup('TUPLE CONTRACT') is info
assert events == ['tuple_contract'] * 5
codecs.unregister(search)
codecs.register(search)
try:
    codecs.lookup('tuple-contract')
except LookupError as error:
    assert error.args == ('unknown encoding: tuple-contract',)
else:
    raise AssertionError('cached result survived unregister')
assert events == ['tuple_contract'] * 6
print('ok')
`,
  },
  {
    name: "normalized collisions share cache entries while dots remain significant",
    source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
def search(name):
    events.append(name)
    return (name, None, None, None)
codecs.register(search)
first = codecs.lookup('  CACHE---Key  ')
for spelling in ('cache_key', 'CACHE KEY', 'cache@key', 'cache\\u2603key'):
    assert codecs.lookup(spelling) is first
assert events == ['cache_key']
dotted = codecs.lookup('cache.key')
assert dotted is not first and dotted[0] == 'cache.key'
assert codecs.lookup('CACHE.KEY') is dotted
empty = codecs.lookup('')
assert codecs.lookup('---') is empty
assert codecs.lookup('\\u2603') is empty
assert events == ['cache_key', 'cache.key', '']
print('ok')
`,
  },
] as const;
