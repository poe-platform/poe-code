/** Public programs replayed unchanged on the pinned external oracle. */
export const codecSearchMutationCases = [
  {
    name: 'removing the current search entry advances through live slots',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
info = (None, None, None, None)
def first(name):
    events.append('first')
    codecs.unregister(first)
def skipped(name):
    events.append('skipped')
    return info
def last(name):
    events.append('last')
    return info
for callback in (first, skipped, last):
    codecs.register(callback)
assert codecs.lookup('live-slots') is info
assert events == ['first', 'last']
assert codecs.lookup('LIVE SLOTS') is info
assert events == ['first', 'last']
print('live slots verified')
`,
    output: 'live slots verified\n',
  },
  {
    name: 'shrinking a search path preserves native indexing failure and retry',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
info = (None, None, None, None)
def first(name):
    events.append('first')
    codecs.unregister(last)
def last(name):
    events.append('last')
    return info
codecs.register(first)
codecs.register(last)
try:
    codecs.lookup('shrinking-path')
except IndexError as error:
    assert error.args == ('list index out of range',)
else:
    assert False
assert events == ['first']
codecs.unregister(first)
codecs.register(last)
assert codecs.lookup('shrinking-path') is info
assert events == ['first', 'last']
print('shrinking path verified')
`,
    output: 'shrinking path verified\n',
  },
  {
    name: 'recursive cache publication is overwritten by the outer successful lookup',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
inner = (1, 2, 3, 4)
outer = (5, 6, 7, 8)
events = []
active = False
def search(name):
    global active
    events.append(name)
    if active:
        return inner
    active = True
    assert codecs.lookup('recursive-name') is inner
    assert codecs.lookup('RECURSIVE NAME') is inner
    return outer
codecs.register(search)
assert codecs.lookup('recursive_name') is outer
assert codecs.lookup('recursive-name') is outer
assert events == ['recursive_name', 'recursive_name']
print('recursive publication verified')
`,
    output: 'recursive publication verified\n',
  },
  {
    name: 'a failing outer callback retains a successfully published recursive result',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
info = (None, None, None, None)
failure = ValueError('outer failure')
events = []
active = False
def search(name):
    global active
    events.append(name)
    if active:
        return info
    active = True
    assert codecs.lookup(name) is info
    raise failure
codecs.register(search)
try:
    codecs.lookup('nested-failure')
except ValueError as error:
    assert error is failure
else:
    assert False
assert codecs.lookup('nested_failure') is info
assert events == ['nested_failure', 'nested_failure']
print('recursive failure verified')
`,
    output: 'recursive failure verified\n',
  },
  {
    name: 'registration during search uses the original length and survives a service callback',
    source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
info = (None, None, None, None)
def appended(name):
    events.append('appended')
    return info
def first(name):
    events.append('first')
    assert input() == 'continue'
    codecs.register(appended)
codecs.register(first)
try:
    codecs.lookup('append-during-search')
except LookupError as error:
    assert error.args == ('unknown encoding: append-during-search',)
else:
    assert False
assert events == ['first']
assert codecs.lookup('append-during-search') is info
assert events == ['first', 'first', 'appended']
print('appended search verified')
`,
    output: 'appended search verified\n',
  },
] as const;
