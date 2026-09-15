const consumers = ["source.encode('consumer-test')", "str.encode(source, 'consumer-test')", "bytes(source, 'consumer-test')", "bytes.__new__(bytes, source, 'consumer-test')"];

export const codecEncoderConsumerCases = consumers.flatMap(expression => [
  {name: `${expression}: input and result identity`, source: `
import _codecs
class Text(str):
    def __str__(self):
        raise AssertionError('coerced input')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('coerced output')
source = Text('')
result = Data(b'output')
seen = []
def encode(*args):
    seen.append(args)
    return (result, object())
def search(name):
    assert name == 'consumer_test'
    return (encode, None, None, None)
_codecs.register(search)
assert ${expression} is result
assert len(seen) == 1
assert len(seen[0]) == 1
assert seen[0][0] is source
_codecs.unregister(search)
`},
  {name: `${expression}: explicit errors`, source: `
import _codecs
source = 'text'
seen = []
def encode(*args):
    seen.append(args)
    return (b'output', None)
def search(name):
    return (encode, None, None, None)
_codecs.register(search)
assert ${expression.slice(0,-1)}, 'custom') == b'output'
assert seen == [(source, 'custom')]
_codecs.unregister(search)
`},
  {name: `${expression}: invalid result`, source: `
import _codecs
source = 'text'
def encode(*args):
    return ('wrong', None)
def search(name):
    return (encode, None, None, None)
_codecs.register(search)
try:
    ${expression}
except TypeError as error:
    assert str(error) == "'consumer-test' encoder returned 'str' instead of 'bytes'; use codecs.encode() to encode to arbitrary types"
else:
    assert False
_codecs.unregister(search)
`},
  {name: `${expression}: callback failure`, source: `
import _codecs
source = 'text'
failure = ValueError('encoder failed')
def encode(*args):
    raise failure
def search(name):
    return (encode, None, None, None)
_codecs.register(search)
try:
    ${expression}
except ValueError as error:
    assert error is failure
    assert error.__notes__ == ["encoding with 'consumer-test' codec failed"]
else:
    assert False
_codecs.unregister(search)
`}
]);
