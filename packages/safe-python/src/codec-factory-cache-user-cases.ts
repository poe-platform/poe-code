/** Guest programs executed unchanged by PythonSession and the pinned oracle. */
export const codecFactoryCacheUserCases = ["encoder", "decoder"].flatMap(direction =>
  ["return", "raise", "nested"].map(outcome => ({
    name: `${direction} factory descriptor invalidates cache: ${outcome}`,
    source: `import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
failure = ValueError('factory descriptor failed')
def original(*args):
    events.append(('original', args))
    return args
def replacement(*args):
    events.append(('replacement', args))
    return args
class Info(tuple):
    @property
    def incremental${direction}(self):
        events.append('descriptor')
        codecs.unregister(search)
        codecs.register(next_search)
        assert input() == 'continue'
        ${outcome === "nested" ? `assert codecs.getincremental${direction}('FACTORY CACHE') is replacement` : "pass"}
        ${outcome === "raise" ? "raise failure" : "return original"}
class NextInfo(tuple):
    incremental${direction} = staticmethod(replacement)
info = Info((None, None, None, None))
next_info = NextInfo((None, None, None, None))
def search(name):
    events.append(('search', name))
    return info
def next_search(name):
    events.append(('next', name))
    return next_info
codecs.register(search)
assert codecs.lookup('factory-cache') is info
try:
    factory = codecs.getincremental${direction}('FACTORY CACHE')
except ValueError as error:
    assert error is failure
    assert error.args == ('factory descriptor failed',)
    print('failure', error is failure)
else:
    assert factory is original
    assert factory('first') == ('first',)
    print('original', factory is original)
factory = codecs.getincremental${direction}('factory_cache')
assert factory is replacement
assert factory('second') == ('second',)
assert codecs.lookup('FACTORY-CACHE') is next_info
print(events)
codecs.unregister(next_search)
try:
    codecs.lookup('factory-cache')
except LookupError as error:
    print(type(error).__name__, error.args)
else:
    raise AssertionError('cache survived removal of final search function')
`,
  })),
);
