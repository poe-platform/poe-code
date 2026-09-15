/** Complete programs shared by public interpreter tests and the external oracle. */
export const codecMapAliasCases = [
  {
    name: "identity map retains first equal key and last value with iterator effects",
    source: String.raw`
import codecs
events = []
class Key:
    def __init__(self, name):
        self.name = name
    def __hash__(self):
        events.append(('hash', self.name))
        return 19
    def __eq__(self, other):
        events.append(('equal', self.name, other.name))
        return True
first, second = Key('first'), Key('second')
def entries():
    events.append('start')
    yield first
    events.append('between')
    yield second
    events.append('end')
mapping = codecs.make_identity_dict(entries())
assert type(mapping) is dict and len(mapping) == 1
assert next(iter(mapping)) is first
assert next(iter(mapping.values())) is second
print(events)
print(codecs.make_identity_dict(rng=range(3)))
`
  },
  {
    name: "encoding map calls items once and preserves duplicate target identity",
    source: String.raw`
import codecs
events = []
class Key:
    def __init__(self, name):
        self.name = name
    def __hash__(self):
        events.append(('hash', self.name))
        return 19
    def __eq__(self, other):
        events.append(('equal', self.name, other.name))
        return True
first, second = Key('first'), Key('second')
class Mapping:
    def items(self):
        events.append('items')
        return [(1, first), (2, second), (3, first)]
mapping = codecs.make_encoding_map(decoding_map=Mapping())
assert type(mapping) is dict and len(mapping) == 1
assert next(iter(mapping)) is first
assert next(iter(mapping.values())) is None
print(events)
print(codecs.make_encoding_map({1: 10, 2: 11, 3: 10, 4: None, 5: None}))
`
  },
  ...["ascii", "latin_1", "utf_8", "charmap"].map(module => ({
    name: `${module} aliases are published after entry caching and preserve collisions`,
    source: `
import codecs
import encodings
import encodings.aliases
import encodings.${module} as module
events = []
entry = module.getregentry()
key = 'owned_alias_${module}'
alias = 'published_alias_${module}'
collision = 'collision_alias_${module}'
encodings.aliases.aliases[key] = '${module}'
encodings.aliases.aliases[collision] = 'latin_1'
assert encodings._aliases is encodings.aliases.aliases
def getregentry():
    events.append('entry')
    return entry
def getaliases():
    events.append('aliases')
    assert encodings._cache[key] is entry
    assert codecs.lookup(key) is entry
    yield alias
    events.append('collision')
    yield collision
    events.append('end')
module.getregentry = getregentry
module.getaliases = getaliases
assert codecs.lookup(key) is entry
assert encodings.aliases.aliases[alias] == '${module}'
assert encodings.aliases.aliases[collision] == 'latin_1'
assert codecs.lookup(key.upper()) is entry
assert events == ['entry', 'aliases', 'collision', 'end']
print(events)
`
  })),
  {
    name: "alias iteration failure retains partial aliases and the cached codec",
    source: `
import codecs
import encodings
import encodings.ascii as module
events = []
entry = module.getregentry()
failure = ValueError('alias iteration failed')
encodings._aliases['partial_alias_entry'] = 'ascii'
def getregentry():
    events.append('entry')
    return entry
def getaliases():
    events.append('aliases')
    yield 'partial_alias_published'
    raise failure
module.getregentry = getregentry
module.getaliases = getaliases
try:
    codecs.lookup('partial_alias_entry')
except ValueError as error:
    assert error is failure and error.args == ('alias iteration failed',)
else:
    assert False
assert encodings._cache['partial_alias_entry'] is entry
assert encodings._aliases['partial_alias_published'] == 'ascii'
assert codecs.lookup('partial_alias_entry') is entry
assert events == ['entry', 'aliases']
print(events)
`
  },
  {
    name: "getaliases AttributeError is swallowed but iterator AttributeError propagates",
    source: `
import codecs
import encodings
import encodings.ascii as module
entry = module.getregentry()
failure = AttributeError('alias failure')
module.getregentry = lambda: entry
def getaliases():
    raise failure
module.getaliases = getaliases
encodings._aliases['alias_call_attribute'] = 'ascii'
assert codecs.lookup('alias_call_attribute') is entry
def getaliases():
    yield 'attribute_alias_published'
    raise failure
module.getaliases = getaliases
encodings._aliases['alias_iter_attribute'] = 'ascii'
try:
    codecs.lookup('alias_iter_attribute')
except AttributeError as error:
    assert error is failure
else:
    assert False
assert codecs.lookup('alias_iter_attribute') is entry
print(encodings._aliases['attribute_alias_published'])
`
  },
  {
    name: "alias callback reads from the explicit input service before publishing",
    source: `
import codecs
import encodings
import encodings.ascii as module
entry = module.getregentry()
encodings._aliases['service_alias_entry'] = 'ascii'
module.getregentry = lambda: entry
def getaliases():
    alias = input()
    assert alias == 'service_alias_published'
    print(alias)
    return [alias]
module.getaliases = getaliases
assert codecs.lookup('service_alias_entry') is entry
assert encodings._aliases['service_alias_published'] == 'ascii'
`
  },
  {
    name: "encoding map does not consume later items after unhashable target",
    source: `
import codecs
events = []
class Mapping:
    def items(self):
        events.append('first')
        yield (1, 65)
        events.append('invalid')
        yield (2, [])
        raise AssertionError('consumed after unhashable target')
try:
    codecs.make_encoding_map(Mapping())
except TypeError as error:
    assert error.args == ("cannot use 'list' as a dict key (unhashable type: 'list')",)
else:
    assert False
print(events)
`
  }
];
