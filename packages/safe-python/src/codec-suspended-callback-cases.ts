/** These programs also run unchanged in the pinned external CPython oracle. */
export const codecSuspendedCallbackCases = [
  {
    name: "search callback generator is rejected without entering its body",
    source: String.raw`
import codecs
events = []
def search(name):
    events.append(name)
    yield (None, None, None, None)
codecs.register(search)
for attempt in range(2):
    try:
        codecs.lookup('suspended-search')
    except TypeError as error:
        assert error.args == ('codec search functions must return 4-tuples',)
        assert not hasattr(error, '__notes__')
    else:
        assert False
assert events == []
codecs.unregister(search)
`
  },
  ...(["encode", "decode"] as const).map(operation => ({
    name: `${operation} callback generator is rejected before iteration`,
    source: String.raw`
import codecs
events = []
def callback(*args):
    events.append(args)
    yield ('unused', 0)
def search(name):
    return (callback, callback, None, None)
codecs.register(search)
try:
    codecs.${operation}(object(), 'suspended-transform')
except TypeError as error:
    assert error.args == (${JSON.stringify(operation === "encode" ? "encoder must return a tuple (object, integer)" : "decoder must return a tuple (object,integer)")},)
    assert not hasattr(error, '__notes__')
else:
    assert False
assert events == []
`
  })),
  ...(["encode", "decode"] as const).map(operation => ({
    name: `${operation} error handler generator is rejected before iteration`,
    source: String.raw`
import _codecs
events = []
def callback(error):
    events.append(error)
    yield ('?', error.end)
_codecs.register_error('suspended-handler', callback)
try:
    _codecs.ascii_${operation}(${operation === "encode" ? "'é'" : "b'\\xff'"}, 'suspended-handler')
except TypeError as error:
    assert error.args == (${JSON.stringify(operation === "encode" ? "encoding error handler must return (str/bytes, int) tuple" : "decoding error handler must return (str, int) tuple")},)
    assert not hasattr(error, '__notes__')
else:
    assert False
assert events == []
`
  })),
  ...["incrementalencoder", "incrementaldecoder", "reader", "writer"].map(factory => ({
    name: `${factory} factory retains its suspended generator and guest arguments`,
    source: String.raw`
import codecs
events = []
token = object()
def factory(*args):
    events.append(args)
    try:
        yield token
    finally:
        events.append('closed')
def search(name):
    return codecs.CodecInfo(None, None, factory, factory,
                           factory, factory, name='suspended-factory')
codecs.register(search)
constructor = codecs.get${factory}('suspended-factory')
assert constructor is factory
argument = object()
pending = constructor(argument)
assert events == []
codecs.unregister(search)
assert next(pending) is token
assert events == [(argument,)]
pending.close()
assert events == [(argument,), 'closed']
`
  }))
];
