/** Execute unchanged on the pinned oracle and the public interpreter. */
export const codecSourceRegistryCases = [
  {name: "source decoder receives an ownerless buffer after newline translation", source: `
import codecs
events = []
views = []
class Text(str):
    def __str__(self):
        raise AssertionError('virtual source conversion')
class Pair(tuple):
    def __getitem__(self, key):
        raise AssertionError('virtual codec result indexing')
def decode(*args):
    view = args[0]
    views.append(view)
    events.append((len(args), type(view).__name__, view.obj, view.readonly,
                   view.format, view.shape, view.strides, view.suboffsets,
                   view.tobytes()))
    return Pair((Text('value = 42\\n'), object()))
def search(name):
    events.append(name)
    return codecs.CodecInfo(None, decode, name=name)
codecs.register(search)
exec(compile(b'# coding: source-contract\\r\\nvalue = 1', 'source.py', 'exec'))
print(value)
print(events)
view = views[0]
view.release()
try:
    view.tobytes()
except ValueError as error:
    print(type(error).__name__, error.args)
`},
  {name: "source callback failures retain native tokenizer conversion", source: `
import codecs
failure = None
def decode(*args):
    raise failure
def search(name):
    return codecs.CodecInfo(None, decode, name=name)
codecs.register(search)
for failure in (ValueError('value failure'), LookupError('lookup failure'),
                TypeError('type failure'), RuntimeError('runtime failure')):
    try:
        compile(b'# coding: source-failure\\nvalue = 1', 'source.py', 'exec')
    except BaseException as error:
        print(type(error).__name__, error.args, error is failure)
        print(getattr(error, '__notes__', None), error.__context__ is None)
        print(getattr(error, 'filename', None), getattr(error, 'lineno', None),
              getattr(error, 'offset', None), getattr(error, 'text', None))
`},
  {name: "source codec callbacks use the supplied input and output services", source: `
import codecs
def decode(*args):
    print('decode')
    assert input() == 'continue'
    return ('value = 42\\n', 0)
def search(name):
    print('search', name)
    return codecs.CodecInfo(None, decode, name=name)
codecs.register(search)
exec(compile(b'# coding: source-service\\nvalue = 1', 'source.py', 'exec'))
print(value)
`}
] as const;
