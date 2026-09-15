/** Public text-consumer contracts checked with the external CPython 3.14.7
 * oracle. Importing this data never starts Python or grants host capabilities. */
export const punycodeRecoveryCases=[
  {name:"caches registered strict recovery across ASCII-prefix faults",source:String.raw`
seen = []
def replacement(error):
    seen.append('new')
    return ('!', error.end)
def handler(error):
    seen.append(error)
    _codecs.register_error('strict', replacement)
    return ('?', error.end)
_codecs.register_error('strict', handler)
assert decode(b'\xffA\xfe-') == '?A?'
assert seen[0] is seen[1]
assert seen[0].encoding == 'ascii'
assert seen[0].object == b'\xffA\xfe'
assert seen[0].args == ('ascii', b'\xffA\xfe', 0, 1, 'ordinal not in range(128)')
assert (seen[0].start, seen[0].end) == (2, 3)
assert decode(b'\xff-') == '!'
assert seen[2] == 'new'
`},
  {name:"resumes within a replaced ASCII prefix at a negative position",source:String.raw`
seen = []
def handler(error):
    seen.append(error)
    error.object = b'XY'
    return ('?', -1)
_codecs.register_error('strict', handler)
assert decode(b'\xff-') == '?Y'
assert seen[0].object == b'XY'
assert seen[0].args[1] == b'\xff'
`},
  {name:"propagates a non-Unicode guest failure by identity",source:String.raw`
failure = KeyboardInterrupt('guest')
def handler(error):
    raise failure
_codecs.register_error('strict', handler)
try:
    decode(b'\xff-')
except KeyboardInterrupt as caught:
    assert caught is failure
    assert caught.args == ('guest',)
else:
    assert False
`},
  {name:"rewrites a guest UnicodeDecodeError with the complete Punycode input",source:String.raw`
failure = UnicodeDecodeError('custom', b'other', 1, 3, 'guest reason')
def handler(error):
    raise failure
_codecs.register_error('strict', handler)
try:
    decode(b'A\xff-z')
except UnicodeDecodeError as caught:
    assert caught is not failure
    assert caught.args == ('ascii', b'A\xff-z', 1, 3, 'guest reason')
    assert caught.__context__ is failure
    assert caught.__cause__ is None
    assert caught.__suppress_context__ is True
else:
    assert False
`},
  {name:"keeps ASCII ignore and replace fast paths and rejects unsupported policies",source:String.raw`
def handler(error):
    raise AssertionError('unexpected recovery')
for name in ('strict', 'ignore', 'replace'):
    _codecs.register_error(name, handler)
assert decode(b'\xff-', 'ignore') == ''
assert decode(b'\xff-', 'replace') == '\ufffd'
assert decode(b'plain-') == 'plain'
for policy in ('custom', 'surrogatepass', 'backslashreplace'):
    try:
        decode(b'plain-', policy)
    except UnicodeError as error:
        assert error.args == ('Unsupported error handling: ' + policy,)
    else:
        assert False
`},
  {name:"reads rewritten error attributes before converting positions",source:String.raw`
events = []
class Position:
    def __index__(self):
        events.append('index')
        return 2
class Failure(UnicodeDecodeError):
    def __getattribute__(self, name):
        if name in ('start', 'end', 'reason'):
            events.append(name)
        if name == 'start':
            return Position()
        return super().__getattribute__(name)
failure = Failure('custom', b'other', 0, 4, 'reason')
def handler(error):
    raise failure
_codecs.register_error('strict', handler)
try:
    decode(b'\xff-')
except UnicodeDecodeError as caught:
    assert type(caught) is UnicodeDecodeError
    assert (caught.start, caught.end, caught.reason) == (2, 4, 'reason')
    assert caught.__context__ is failure
    assert events == ['start', 'end', 'reason', 'index']
else:
    assert False
`},
  {name:"chains failures during rewritten error attribute access",source:String.raw`
secondary = ValueError('attribute')
class Failure(UnicodeDecodeError):
    def __getattribute__(self, name):
        if name == 'end':
            raise secondary
        return super().__getattribute__(name)
failure = Failure('custom', b'other', 0, 1, 'reason')
def handler(error):
    raise failure
_codecs.register_error('strict', handler)
try:
    decode(b'\xff-')
except ValueError as caught:
    assert caught is secondary
    assert caught.__context__ is failure
    assert caught.__cause__ is None
    assert caught.__suppress_context__ is False
else:
    assert False
`},
  {name:"chains constructor validation before suppressing the original error",source:String.raw`
failure = UnicodeDecodeError('custom', b'other', 0, 1, 'reason')
failure.reason = None
def handler(error):
    raise failure
_codecs.register_error('strict', handler)
try:
    decode(b'\xff-')
except TypeError as caught:
    assert caught.args == ('argument 5 must be str, not None',)
    assert caught.__context__ is failure
    assert caught.__cause__ is None
    assert caught.__suppress_context__ is False
else:
    assert False
`},
] as const;
