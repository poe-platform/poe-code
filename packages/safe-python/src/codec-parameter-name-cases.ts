/** Programs shared unchanged by the public interpreter and external oracle. */
export const codecParameterNameCases = [
  "IncrementalEncoder", "IncrementalDecoder", "BufferedIncrementalEncoder", "BufferedIncrementalDecoder"
].map(base => ({name: base, source: `
import codecs
seen = []
names = ('self', 'errors')
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        seen.append((other, other is names[len(seen)]))
        return str.__eq__(self, other)
value = codecs.${base}(**{Key('errors'): 'replace'})
assert seen == [('self', True), ('errors', True)], seen
assert value.errors == 'replace'
print(seen, value.errors)
`}));

export const codecParameterDefaultCases = [
  "IncrementalEncoder", "IncrementalDecoder", "BufferedIncrementalEncoder", "BufferedIncrementalDecoder"
].map(base => ({name: base, source: `
import codecs
seen = []
expected = 'errors'
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        seen.append((other, other is expected))
        return str.__eq__(self, other)
class Custom(codecs.${base}):
    def __init__(self, *, errors='strict'):
        self.errors = errors
Custom.__init__.__kwdefaults__ = {Key('errors'): 'replace'}
value = Custom()
assert seen == [('errors', True)], seen
assert value.errors == 'replace'
print(seen, value.errors)
`}));

export const codecParameterServiceCases = [1, 2].map(stage => ({name: `comparison ${stage}`, source: `
import codecs
seen = []
names = ('self', 'errors')
failure = ValueError('keyword comparison')
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        assert other is names[len(seen)]
        seen.append(other)
        if len(seen) == ${stage}:
            assert input() == 'continue'
            raise failure
        return str.__eq__(self, other)
try:
    codecs.IncrementalDecoder(**{Key('errors'): 'replace'})
except ValueError as caught:
    assert caught is failure
    assert caught.args == ('keyword comparison',)
    assert seen == list(names[:${stage}])
else:
    raise AssertionError('keyword callback failure lost')
print(seen)
`}));
