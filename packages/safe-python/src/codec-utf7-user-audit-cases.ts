/** Deterministic malformed-input exploration, replayed as unchanged guest programs. */
const alphabet = [43, 45, 65, 66, 68, 72, 80, 47, 48, 57, 97, 122, 32, 0, 127, 128, 255];
const policies = ["strict", "ignore", "replace", "surrogateescape", "backslashreplace"];

function inputs(count: number, seed: number, period: number): number[][] {
  return Array.from({length: count}, (_, index) => Array.from({length: index % period}, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return alphabet[seed % alphabet.length];
  }));
}

const ordinary = inputs(12000, 839, 13);
const replacements = inputs(5000, 932, 17);

export const codecUtf7UserAuditCases = [
  ...Array.from({length: ordinary.length / 50}, (_, batch) => ({
    name: `ordinary and incremental batch ${batch}`,
    source: `
import codecs
rows = [${ordinary.slice(batch * 50, (batch + 1) * 50).map((bytes, offset) => {
  const index = batch * 50 + offset;
  return `(bytes(${JSON.stringify(bytes)}), '${policies[index % policies.length]}', ${index % 2 === 0 ? "True" : "False"})`;
}).join(",")}]
def failure(error):
    return (type(error).__name__, error.args, error.encoding, error.object, error.start, error.end, error.reason)
def step(decoder, data, final):
    try:
        text = decoder.decode(data, final)
        assert type(text) is str
        result = ('text', text)
    except UnicodeDecodeError as error:
        result = failure(error)
    state = decoder.getstate()
    assert type(state) is tuple and type(state[0]) is bytes and type(state[1]) is int
    return (result, state)
for data, policy, final in rows:
    try:
        result = codecs.utf_7_decode(data, policy, final)
        assert type(result) is tuple and type(result[0]) is str and type(result[1]) is int
    except UnicodeDecodeError as error:
        result = failure(error)
    print(ascii(result))
    decoder = codecs.getincrementaldecoder('utf-7')(policy)
    split = len(data) // 2
    print(ascii(step(decoder, data[:split], False)))
    saved = decoder.getstate()
    restored = codecs.getincrementaldecoder('utf-7')(policy)
    assert restored.setstate(saved) is None
    tail = step(decoder, data[split:], final)
    assert step(restored, data[split:], final) == tail
    print(ascii(tail))
    print(ascii(step(decoder, b'', True)))
    assert decoder.reset() is None and decoder.getstate() == (b'', 0)
`
  })),
  ...Array.from({length: replacements.length / 50}, (_, batch) => ({
    name: `replacement input and negative resume batch ${batch}`,
    source: `
import codecs
rows = [${replacements.slice(batch * 50, (batch + 1) * 50).map((bytes, offset) => `(bytes(${JSON.stringify(bytes)}), ${(batch * 50 + offset) % 2 === 0 ? "True" : "False"})`).join(",")}]
for replacement, final in rows:
    seen = []
    retained = []
    class Position:
        def __index__(self):
            retained[0].object = replacement
            return -len(replacement)
    def handler(error):
        assert type(error) is UnicodeDecodeError
        seen.append((error.args, error.encoding, error.object, error.start, error.end, error.reason))
        if not retained:
            retained.append(error)
            return ('?', Position())
        assert error is retained[0]
        assert len(seen) <= 40
        return ('?', len(error.object))
    codecs.register_error('user-audit', handler)
    result = codecs.utf_7_decode(b'\\xff', 'user-audit', final)
    assert type(result) is tuple and type(result[0]) is str and type(result[1]) is int
    print(ascii((result, seen)))
`
  }))
];

export const codecUtf7UserAuditServiceSource = `
import codecs
decoder = codecs.getincrementaldecoder('utf-7')('user-service')
failure = ValueError('handler failed')
retained = []
def handler(error):
    retained.append(error)
    assert input() == 'ready'
    decoder.setstate((b'+IK', 0))
    raise failure
codecs.register_error('user-service', handler)
try:
    decoder.decode(b'\\xff', True)
except ValueError as error:
    assert error is failure
else:
    assert False
assert decoder.getstate() == (b'+IK', 0)
assert (retained[0].start, retained[0].end, retained[0].object) == (0, 1, b'\\xff')
decoder.errors = 'strict'
assert decoder.decode(b'w-', True) == '\\u20ac'
assert decoder.getstate() == (b'', 0)
print('UTF-7 recovery verified')
`;
