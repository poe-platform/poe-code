/** Execute unchanged in PythonSession and the pinned external CPython oracle. */
const consumers = [
  "source.encode(name)",
  "str.encode(source, name)",
  "bytes(source, name)",
  "bytes.__new__(bytes, source, name)",
];

export const codecEmptySearchCases = consumers.flatMap(expression => ["", "text"].flatMap(content => [
  {
    name: `${expression}, ${JSON.stringify(content)}: empty search path diagnostics`,
    source: `
import codecs
import encodings
source = ${JSON.stringify(content)}
name = 'empty-search-contract'
codecs.unregister(encodings.search_function)
for attempt in range(2):
    try:
        ${expression}
    except LookupError as error:
        assert type(error) is LookupError
        assert error.args == ("no codec search functions registered: can't find encoding",), error.args
        assert not hasattr(error, '__notes__')
    else:
        raise AssertionError('empty search path accepted')
assert source.encode('utf-8') == ${JSON.stringify(content)}.encode()
events = []
def miss(name):
    events.append(name)
codecs.register(miss)
try:
    ${expression}
except LookupError as error:
    assert error.args == ('unknown encoding: empty-search-contract',)
else:
    raise AssertionError('search miss accepted')
assert events == ['empty_search_contract']
codecs.unregister(miss)
try:
    ${expression}
except LookupError as error:
    assert error.args == ("no codec search functions registered: can't find encoding",)
else:
    raise AssertionError('removed search accepted')
print('ok')
`,
  },
  {
    name: `${expression}, ${JSON.stringify(content)}: cached self-unregistered codec`,
    source: `
import codecs
import encodings
source = ${JSON.stringify(content)}
name = 'empty-search-contract'
codecs.unregister(encodings.search_function)
events = []
def encode(value):
    events.append(value)
    return (b'cached', len(value))
info = codecs.CodecInfo(encode, None, name=name)
def search(normalized):
    events.append(normalized)
    codecs.unregister(search)
    return info
codecs.register(search)
assert ${expression} == b'cached'
assert codecs.lookup(name) is info
name = 'EMPTY SEARCH CONTRACT'
assert ${expression} == b'cached'
codecs.unregister(search)
assert ${expression} == b'cached'
assert events == ['empty_search_contract', source, source, source], events
def unused(name):
    raise AssertionError('cache hit searched again')
codecs.register(unused)
assert ${expression} == b'cached'
codecs.unregister(unused)
try:
    ${expression}
except LookupError as error:
    assert error.args == ("no codec search functions registered: can't find encoding",), error.args
else:
    raise AssertionError('cache survived actual removal')
print('ok')
`,
  },
]));

codecEmptySearchCases.push({
  name: "cached codec retains live text flags, callback failures and result validation",
  source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
events = []
failure = ValueError('cached encoder failed')
result = (b'cached', None)
def encode(value):
    events.append(value)
    if result is failure:
        raise failure
    return result
info = codecs.CodecInfo(encode, None, name='empty-cache-validation')
def search(name):
    codecs.unregister(search)
    return info
codecs.register(search)
assert codecs.lookup('empty-cache-validation') is info
info._is_text_encoding = False
try:
    'text'.encode('empty-cache-validation')
except LookupError as error:
    assert error.args == ("'empty-cache-validation' is not a text encoding; use codecs.encode() to handle arbitrary codecs",), error.args
    assert not hasattr(error, '__notes__')
else:
    raise AssertionError('nontext codec accepted')
assert events == []
info._is_text_encoding = True
result = failure
try:
    'text'.encode('empty-cache-validation')
except ValueError as caught:
    assert caught is failure
    assert caught.__notes__ == ["encoding with 'empty-cache-validation' codec failed"]
else:
    raise AssertionError('callback failure swallowed')
result = [b'wrong container', 0]
try:
    'text'.encode('empty-cache-validation')
except TypeError as error:
    assert error.args == ('encoder must return a tuple (object, integer)',)
    assert not hasattr(error, '__notes__')
else:
    raise AssertionError('malformed result accepted')
result = (b'recovered', object())
assert 'text'.encode('empty-cache-validation') == b'recovered'
assert codecs.lookup('empty-cache-validation') is info
assert events == ['text', 'text', 'text']
print('ok')
`,
});

export const codecEmptySearchCancellationCases = [false, true].map(throws => ({
  name: `cached encoder cancellation (throws=${throws})`,
  source: `
import codecs
import encodings
codecs.unregister(encodings.search_function)
def encode(value):
    input()
    ${throws ? "raise ValueError('cancelled encoder')" : "return (b'cached', 0)"}
info = codecs.CodecInfo(encode, None, name='cancel-empty-cache')
def search(name):
    codecs.unregister(search)
    return info
codecs.register(search)
assert codecs.lookup('cancel-empty-cache') is info
try:
    'text'.encode('cancel-empty-cache')
except BaseException:
    print('recovered after cancellation')
`,
}));
