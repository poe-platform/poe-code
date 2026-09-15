/** Public programs shared unchanged with the pinned external oracle. */
const operations = [
  ...["ascii", "latin_1", "utf_8", "utf_16_le", "utf_16_be", "utf_32_le", "utf_32_be"].map(codec => ({
    name: `${codec}_encode`, input: String.raw`'\ud800A\ud800'`, final: ""
  })),
  ...[
    ["ascii", String.raw`b'\xffA\xff'`],
    ["utf_8", String.raw`b'\xffA\xff'`],
    ["utf_7", String.raw`b'\xffA\xff'`],
    ["utf_16_le", String.raw`b'\x00\xdcA\x00\x00\xdc'`],
    ["utf_16_be", String.raw`b'\xdc\x00\x00A\xdc\x00'`],
    ["utf_32_le", String.raw`b'\x00\xd8\x00\x00A\x00\x00\x00\x00\xd8\x00\x00'`],
    ["utf_32_be", String.raw`b'\x00\x00\xd8\x00\x00\x00\x00A\x00\x00\xd8\x00'`],
    ["unicode_escape", String.raw`b'\\uXXA\\uXX'`],
    ["raw_unicode_escape", String.raw`b'\\uXXA\\uXX'`]
  ].map(([codec, input]) => ({name: `${codec}_decode`, input, final: codec === "ascii" ? "" : ", True"}))
];

export const codecHandlerMutationCases = operations.flatMap(({name, input, final}) => ["replace", "remove"].map(mutation => ({
  name: `${name}: ${mutation} during recovery`,
  source: String.raw`import codecs
import _codecs
events = []
faults = []
source = ${input}
def run():
    return codecs.${name}(source, 'mutating_handler'${final})
def replacement(error):
    events.append(('new', error.start, error.end))
    return ('!', error.end)
def original(error):
    faults.append(error)
    events.append(('old', error.start, error.end))
    if len(faults) == 1:
        assert _codecs._unregister_error('mutating_handler') is True
        assert _codecs._unregister_error('mutating_handler') is False
        try:
            codecs.lookup_error('mutating_handler')
        except LookupError as missing:
            print(type(missing).__name__, missing.args)
        else:
            raise AssertionError('removed handler remains registered')
        ${mutation === "replace" ? "codecs.register_error('mutating_handler', replacement)" : "pass"}
        try:
            print('nested', run())
        except LookupError as missing:
            print('nested', type(missing).__name__, missing.args)
    return ('?', error.end - len(source) if error.end < len(source) else error.end)
codecs.register_error('mutating_handler', original)
print('outer', run())
print('events', events)
print('identity', [error is faults[0] for error in faults])
print('args', [error.args for error in faults])
try:
    print('next', run())
except LookupError as missing:
    print('next', type(missing).__name__, missing.args)
print('final events', events)
`
})));

export const codecHandlerMutationServiceCases = operations.map(({name, input, final}) => ({
  name: `${name}: serviced failure after handler replacement`,
  source: String.raw`import codecs
import _codecs
source = ${input}
failure = ValueError('serviced recovery')
events = []
def replacement(error):
    events.append(('new', error.start, error.end))
    return ('!', error.end)
def original(error):
    events.append(('old', error.start, error.end))
    assert _codecs._unregister_error('serviced_handler') is True
    codecs.register_error('serviced_handler', replacement)
    assert input() == 'service'
    raise failure
codecs.register_error('serviced_handler', original)
try:
    codecs.${name}(source, 'serviced_handler'${final})
except ValueError as caught:
    assert caught is failure
    print(type(caught).__name__, caught.args)
else:
    raise AssertionError('handler failure was swallowed')
assert codecs.lookup_error('serviced_handler') is replacement
print('next', codecs.${name}(source, 'serviced_handler'${final}))
print(events)
`
}));
