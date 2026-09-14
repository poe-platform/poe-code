/** Unchanged programs for the CPython 3.14.7 external oracle and guest runtime. */
export const codecCStringDiagnosticCases = [
  ...['strict', 'ignore', 'replace', 'surrogatepass'].map(builtin => ({
    name: `unregister raw alias of ${builtin}`,
    source: String.raw`
import codecs, _codecs
name = '\ud800'
seen = []
def strict(error):
    seen.append(type(error).__name__)
    return (b'\x80', error.end) if isinstance(error, UnicodeEncodeError) else ('${builtin}', error.end)
codecs.register_error('strict', strict)
assert _codecs._unregister_error(name) is True
assert seen == ['UnicodeEncodeError', 'UnicodeDecodeError']
try:
    _codecs._unregister_error('${builtin}')
except ValueError as error:
    assert str(error) == "cannot un-register built-in error handler '${builtin}'"
else:
    assert False
print('ok')
`
  })),
  ...[
    ["b'\\x80' * 401", "'\\ufffd' * 400"],
    ["b'a' * 399 + b'\\xe2\\x82\\xac'", "'a' * 399", 'valid'],
    ["b'a' * 399 + b'\\xff'", "'a' * 399 + '\\ufffd'"],
    ["b'a' * 398 + b'\\xf0\\x9f\\x98\\x80'", "'a' * 398", 'valid'],
    ["b'a' * 399 + b'\\xe2'", "'a' * 399"],
    ["b'a' * 398 + b'\\xe2'", "'a' * 398 + '\\ufffd'"],
    ["b'a' * 399 + b'\\xe2\\x00'", "'a' * 399 + '\\ufffd'"]
  ].map(([raw, expected, validity]) => ({
    name: `raw diagnostic ${raw}`,
    source: String.raw`
import codecs
name = '\ud800'
seen = []
def strict(error):
    seen.append(type(error).__name__)
    return (${raw}, error.end) if isinstance(error, UnicodeEncodeError) else ('missing', len(error.object))
codecs.register_error('strict', strict)
try:
    codecs.lookup_error(name)
except ${raw.includes('x00') ? 'ValueError' : 'LookupError'} as error:
    assert str(error) == ${raw.includes('x00') ? "'embedded null character'" : `"unknown error handler name '" + ${expected} + "'"`}
else:
    assert False
assert seen == ${raw.includes('x00') || validity === 'valid' ? "['UnicodeEncodeError']" : "['UnicodeEncodeError', 'UnicodeDecodeError']"}
print('ok')
`
  }))
];
