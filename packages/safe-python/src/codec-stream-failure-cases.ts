export const codecStreamFailureCases=[
{name:'writer failure order and captured getattr default',source:`
import codecs
events = []
error = ValueError('write')
class Stream:
    def write(self, value):
        events.append(('write', value))
        raise error
    def close(self):
        events.append('close')
        raise error
    def seek(self, offset, whence):
        events.append(('seek', offset, whence))
        raise error
    def tell(self):
        return 17
class Writer(codecs.StreamWriter):
    def encode(self, value, errors):
        events.append(('encode', value, errors))
        return (b'result', object())
    def reset(self):
        events.append('reset')
writer = Writer(Stream(), 'custom')
for action in (lambda: writer.write('input'), lambda: writer.writelines(['in', 'put'])):
    events.clear()
    try:
        action()
    except ValueError as caught:
        assert caught is error
    else:
        assert False
    assert events == [('encode', 'input', 'custom'), ('write', b'result')]
events.clear()
try:
    writer.seek(0)
except ValueError as caught:
    assert caught is error
assert events == [('seek', 0, 0)]
try:
    with writer:
        raise KeyError('body')
except ValueError as caught:
    assert caught is error
    assert type(caught.__context__) is KeyError
else:
    assert False
assert events[-1] == 'close'
old = codecs.StreamWriter.__getattr__.__defaults__
assert old == (getattr,)
assert writer.tell() == 17
codecs.StreamWriter.__getattr__.__defaults__ = (lambda obj, name: name,)
assert writer.unknown == 'unknown'
codecs.StreamWriter.__getattr__.__defaults__ = old
`},
{name:'buffer decode callback state replacement and aliased final argument',source:`
import codecs
events = []
class Final:
    def __bool__(self):
        raise AssertionError('base class must not test final')
final = Final()
class Decoder(codecs.BufferedIncrementalDecoder):
    def _buffer_decode(self, data, errors, seen_final):
        assert seen_final is final
        events.append((data, errors))
        self.buffer = b'mutated'
        self.errors = 'changed'
        return ('ok', 1)
decoder = Decoder('initial')
assert decoder.decode(b'abc', final) == 'ok'
assert events == [(b'abc', 'initial')]
assert decoder.getstate() == (b'bc', 0)
assert decoder.errors == 'changed'
class Failure(Decoder):
    def _buffer_decode(self, *args):
        self.buffer = b'mutated'
        raise ValueError('failed')
decoder = Failure()
try:
    decoder.decode(b'abc', final)
except ValueError as error:
    assert error.args == ('failed',)
else:
    assert False
assert decoder.getstate() == (b'mutated', 0)
`},
{name:'iterator sees lazy factory mutation and propagates source identity',source:`
import codecs
events = []
class Encoder:
    def __init__(self, errors):
        events.append(('init', errors))
    def encode(self, data, final=False):
        events.append((data, final))
        return b''
iterator = codecs.iterencode(['a'], 'unused')
codecs.getincrementalencoder = lambda encoding: Encoder
assert list(iterator) == []
assert events == [('init', 'strict'), ('a', False), ('', True)]
error = RuntimeError('source')
def source():
    yield 'x'
    raise error
events.clear()
iterator = codecs.iterencode(source(), 'unused')
try:
    next(iterator)
except RuntimeError as caught:
    assert caught is error
else:
    assert False
assert events == [('init', 'strict'), ('x', False)]
assert list(iterator) == []
`}
] as const;
