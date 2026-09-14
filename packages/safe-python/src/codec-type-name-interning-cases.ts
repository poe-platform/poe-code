/** Programs are also executed unchanged by the pinned external oracle. */
const namespaceProbes = [
  ["__slots__", "()", 1], ["__module__", "'codec_probe'", 1], ["__doc__", "'decoder documentation'", 2],
  ["__eq__", "None", 3], ["__hash__", "None", 4], ["__new__", "None", 2],
  ["__init_subclass__", "None", 1], ["__class_getitem__", "None", 1],
  ["__qualname__", "'Qualified.Decoder'", 2],
  ["__classcell__", "(lambda value: lambda: value)(None).__closure__[0]", 2]
] as const;

export const codecTypeNameInterningCases = namespaceProbes.map(([name, value, count]) => ({name, source: `
import codecs
expected = '${name}'
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if str.__eq__(self, other):
            seen.append(other is expected)
        return str.__eq__(self, other)
key = Key(expected)
namespace = {key: ${value}}
Decoder = type('Decoder', (codecs.IncrementalDecoder,), namespace)
assert seen and all(seen), seen
assert seen == [True] * ${count}, seen
assert next(iter(namespace)) is key
`}));

export const codecTypeNameFailureSource = `
import codecs
expected = '__slots__'
class Failure(Exception):
    pass
failure = Failure('namespace lookup')
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if other is expected:
            seen.append(other)
            raise failure
        return str.__eq__(self, other)
try:
    type('Decoder', (codecs.IncrementalDecoder,), {Key(expected): ()})
except Failure as caught:
    assert caught is failure
else:
    assert False, 'namespace callback failure was lost'
assert seen == [expected]
`;

export const codecTypeNameCancellationSource = `
import codecs
expected = '__slots__'
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        if other is expected:
            input()
        return str.__eq__(self, other)
try:
    type('Decoder', (codecs.IncrementalDecoder,), {Key(expected): ()})
except BaseException:
    raise AssertionError('cancellation reached the guest')
raise AssertionError('cancellation was ignored')
`;
