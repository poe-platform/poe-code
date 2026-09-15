/** Unchanged guest programs for the external pinned oracle and PythonSession. */
export const codecTypeMutationAuditCases = ["set", "delete"].flatMap(operation =>
  ["member", "__hash__", "__repr__"].flatMap(member =>
    ["none", "set", "delete"].flatMap(reenter =>
      [0, 1, 2, 3].map(failAt => ({
        name: `${operation} ${member}: reenter=${reenter}, fail=${failAt}`,
        source: `
import codecs
name = '${member}'
seen = []
armed = False
failure = ValueError('comparison')
original = lambda self: 11
replacement = lambda self: 12
nested = lambda self: 13
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        global armed
        equal = str.__eq__(self, other)
        if armed and equal:
            seen.append((other is name, type(other).__name__))
            if len(seen) == 1 and '${reenter}' != 'none':
                armed = False
                if '${reenter}' == 'set':
                    type.__setattr__(C, name, nested)
                else:
                    type.__delattr__(C, name)
                armed = True
            if len(seen) == ${failAt}:
                raise failure
        return equal
key = Key(name)
C = type('C', (codecs.IncrementalDecoder,), {key: original})
armed = True
try:
    ${operation === "set" ? "type.__setattr__(C, name, replacement)" : "type.__delattr__(C, name)"}
except Exception as error:
    armed = False
    print(type(error).__name__, error.args, error is failure)
    print(getattr(error, 'name', None), getattr(error, 'obj', None) is C)
    print(type(error.__context__).__name__, error.__context__ is failure)
else:
    armed = False
    print('ok')
print(seen)
stored = [value for item, value in C.__dict__.items() if item == name]
print(stored == [original], stored == [replacement], stored == [nested], len(stored))
if '${member}' == '__hash__':
    try:
        value = C()
        result = hash(value)
        print('hash', result == 11, result == 12, result == 13, result == object.__hash__(value))
    except TypeError as error:
        print(type(error).__name__, error.args)
`
      })))));

export const codecTypeMutationCancellationCases = (["set", "delete"] as const).flatMap(operation =>
  [1, 2, ...(operation === "set" ? [3] : [])].flatMap(stage =>
    [false, true].map(throws => ({operation, stage, throws, source: `
import codecs
armed = False
seen = []
class Key(str):
    __hash__ = str.__hash__
    def __eq__(self, other):
        equal = str.__eq__(self, other)
        if armed and equal:
            seen.append(other)
            if len(seen) == ${stage}:
                input()
        return equal
C = type('C', (codecs.IncrementalDecoder,), {Key('__hash__'): lambda self: 11})
armed = True
try:
    ${operation === "set" ? "C.__hash__ = lambda self: 12" : "del C.__hash__"}
except BaseException:
    raise AssertionError('cancellation entered guest handling')
raise AssertionError('cancellation was lost')
`}))));
