/** Run unchanged in PythonSession and the pinned external CPython oracle. */
export const codecReentrantSearchCases = [
  {
    name: "self-removal skips the shifted callback and exposes the original search length",
    source: `
import _codecs
events = []
codec = (None, None, None, None)
def first(name):
    events.append('first')
    _codecs.unregister(first)
def second(name):
    events.append('second')
    return codec
_codecs.register(first)
_codecs.register(second)
try:
    _codecs.lookup('mutation_remove')
except IndexError as error:
    assert error.args == ('list index out of range',)
else:
    assert False
assert events == ['first']
assert _codecs.lookup('mutation_remove') is codec
assert events == ['first', 'second']
`
  },
  {
    name: "callbacks appended during a miss participate only in the next lookup",
    source: `
import _codecs
events = []
codec = (None, None, None, None)
def later(name):
    events.append('later')
    return codec
def first(name):
    events.append('first')
    _codecs.register(later)
_codecs.register(first)
try:
    _codecs.lookup('mutation_append')
except LookupError as error:
    assert error.args == ('unknown encoding: mutation_append',)
else:
    assert False
assert events == ['first']
assert _codecs.lookup('mutation_append') is codec
assert events == ['first', 'first', 'later']
`
  },
  {
    name: "removal and append replace a not-yet-called search slot",
    source: `
import _codecs
events = []
codec = (None, None, None, None)
def removed(name):
    raise AssertionError('removed search was invoked')
def replacement(name):
    events.append('replacement')
    return codec
def first(name):
    events.append('first')
    _codecs.unregister(removed)
    _codecs.register(replacement)
_codecs.register(first)
_codecs.register(removed)
assert _codecs.lookup('mutation_replace') is codec
assert events == ['first', 'replacement']
`
  },
  {
    name: "unregister removes one duplicate by identity and invalidates cached hits",
    source: `
import _codecs
events = []
codec = (None, None, None, None)
class Search:
    def __eq__(self, other):
        raise AssertionError('unregister compared search functions')
    def __call__(self, name):
        events.append(name)
        return codec
search = Search()
_codecs.register(search)
_codecs.register(search)
assert _codecs.lookup('mutation_duplicate') is codec
_codecs.unregister(Search())
assert _codecs.lookup('mutation_duplicate') is codec
assert len(events) == 1
_codecs.unregister(search)
assert _codecs.lookup('mutation_duplicate') is codec
assert len(events) == 2
_codecs.unregister(search)
try:
    _codecs.lookup('mutation_duplicate')
except LookupError as error:
    assert error.args == ('unknown encoding: mutation_duplicate',)
else:
    assert False
assert len(events) == 2
`
  },
  {
    name: "nested successful lookup survives an outer search failure",
    source: `
import _codecs
events = []
failure = ValueError('outer lookup failed')
codec = (None, None, None, None)
def search(name):
    events.append(name)
    if len(events) == 1:
        assert _codecs.lookup(name) is codec
        raise failure
    return codec
_codecs.register(search)
try:
    _codecs.lookup('reentrant-failure')
except ValueError as caught:
    assert caught is failure
else:
    assert False
assert events == ['reentrant_failure', 'reentrant_failure']
assert _codecs.lookup('REENTRANT FAILURE') is codec
assert len(events) == 2
`
  },
  {
    name: "outer successful search replaces a nested cache entry",
    source: `
import _codecs
events = []
inner = (None, None, None, None)
outer = (False, False, False, False)
def search(name):
    events.append(name)
    if len(events) == 1:
        assert _codecs.lookup(name) is inner
        return outer
    return inner
_codecs.register(search)
assert _codecs.lookup('reentrant-replace') is outer
assert _codecs.lookup('REENTRANT REPLACE') is outer
assert events == ['reentrant_replace', 'reentrant_replace']
`
  },
  {
    name: "a self-unregistered successful search still populates the cache",
    source: `
import _codecs
events = []
codec = (None, None, None, None)
def search(name):
    events.append(name)
    _codecs.unregister(search)
    return codec
_codecs.register(search)
assert _codecs.lookup('reentrant-remove') is codec
assert _codecs.lookup('REENTRANT REMOVE') is codec
_codecs.unregister(search)
assert _codecs.lookup('reentrant_remove') is codec
assert events == ['reentrant_remove']
`
  },
  {
    name: "a malformed outer search result preserves the nested cache entry",
    source: `
import _codecs
events = []
codec = (None, None, None, None)
def search(name):
    events.append(name)
    if len(events) == 1:
        assert _codecs.lookup(name) is codec
        return [None, None, None, None]
    return codec
_codecs.register(search)
try:
    _codecs.lookup('reentrant-invalid')
except TypeError as caught:
    assert caught.args == ('codec search functions must return 4-tuples',)
else:
    assert False
assert _codecs.lookup('REENTRANT INVALID') is codec
assert events == ['reentrant_invalid', 'reentrant_invalid']
`
  }
];
