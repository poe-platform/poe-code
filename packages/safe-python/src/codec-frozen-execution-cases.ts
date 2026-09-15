/** Programs shared unchanged by unit tests and the external pinned oracle. */
export const codecFrozenExecutionCases = [
  {
    name: "frozen class base resolution binds live descriptors and retries service failure",
    source: `
import codecs
import encodings
original = codecs.Codec
events = []
failure = ValueError('base resolution failure')
class Resolver:
    def __get__(self, instance, owner):
        assert instance is proxy and owner is Proxy
        events.append('bind')
        def resolve(bases):
            assert bases == (proxy,)
            events.append(input())
            if len(events) == 2:
                raise failure
            return (original,)
        return resolve
class Proxy:
    __mro_entries__ = Resolver()
proxy = Proxy()
codecs.Codec = proxy
try:
    import encodings.raw_unicode_escape
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('base resolution failure was swallowed')
assert not hasattr(encodings, 'raw_unicode_escape')
assert events == ['bind', 'annotation']
import encodings.raw_unicode_escape as module
assert events == ['bind', 'annotation', 'bind', 'annotation']
assert module.Codec.__orig_bases__ == (proxy,)
assert module.Codec.__bases__ == (original,)
assert module.Codec().encode('A') == (b'A', 1)
codecs.Codec = original
assert __import__('encodings.raw_unicode_escape', fromlist=['Codec']) is module
print('descriptor retry verified')
`,
    output: "descriptor retry verified\n",
  },
  {
    name: "frozen class creation preserves ordered write flush and input services",
    source: `
import codecs
original = codecs.Codec
events = []
class Base(original):
    def __init_subclass__(cls):
        print(cls.__name__, flush=True)
        events.append((cls.__name__, input()))
codecs.Codec = Base
try:
    import encodings.raw_unicode_escape as module
except BaseException:
    print('recovered')
    raise
assert events == [('Codec', 'annotation'), ('StreamWriter', 'annotation'), ('StreamReader', 'annotation')]
assert module.Codec.__bases__ == (Base,)
codecs.Codec = original
assert module.Codec().encode('A') == (b'A', 1)
`,
    output: "Codec\nStreamWriter\nStreamReader\n",
  },
  {
    name: "failed frozen module execution retries with live globals",
    source: `
import codecs
import encodings
original = codecs.Codec
events = []
failure = ValueError('frozen class failure')
class Base:
    def __init_subclass__(cls):
        events.append(cls.__name__)
        print('class', cls.__name__)
        raise failure
codecs.Codec = Base
try:
    import encodings.unicode_escape
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('failed import was cached')
assert events == ['Codec']
assert not hasattr(encodings, 'unicode_escape')
codecs.Codec = original
import encodings.unicode_escape as module
assert module.Codec.__bases__ == (original,)
assert module.Codec().encode('A') == (b'A', 1)
assert module.getregentry.__globals__ is module.__dict__
assert __import__('encodings.unicode_escape', fromlist=['*']) is module
print('retry verified')
`,
    output: "class Codec\nretry verified\n",
  },
  {
    name: "late frozen import failure retains escaped classes without poisoning retry",
    source: `
import codecs
import encodings
original = codecs.Codec
escaped = []
partial_modules = []
failure = ValueError('late import failure')
class Base(original):
    def __init_subclass__(cls):
        escaped.append(cls)
        partial_modules.append(__import__('encodings.raw_unicode_escape', fromlist=['__name__']))
        if cls.__name__ == 'StreamReader':
            raise failure
codecs.Codec = Base
try:
    import encodings.raw_unicode_escape
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('late failure was swallowed')
assert [cls.__name__ for cls in escaped] == ['Codec', 'StreamWriter', 'StreamReader']
assert not hasattr(encodings, 'raw_unicode_escape')
old_codec, old_writer, old_reader = escaped
assert old_writer.__bases__[0] is old_codec
assert old_reader.__bases__[0] is old_codec
assert old_codec().encode('A') == (b'A', 1)
codecs.Codec = original
import encodings.raw_unicode_escape as fresh
assert fresh.Codec is not old_codec
assert fresh.StreamWriter is not old_writer
assert fresh.StreamReader is not old_reader
assert fresh.Codec.__bases__ == (original,)
assert fresh.StreamWriter.__bases__[0] is fresh.Codec
assert fresh.Codec.encode is old_codec.encode
assert fresh.Codec().encode('A') == old_codec().encode('A')
assert __import__('encodings.raw_unicode_escape', fromlist=['Codec']) is fresh
partial = partial_modules[0]
assert all(module is partial for module in partial_modules)
assert partial is not fresh and partial.__dict__ is not fresh.__dict__
old_encode = partial.IncrementalEncoder.encode
new_encode = fresh.IncrementalEncoder.encode
assert old_encode.__globals__ is partial.__dict__
assert new_encode.__globals__ is fresh.__dict__
assert old_encode.__code__ is not new_encode.__code__
assert old_encode.__code__.co_consts == new_encode.__code__.co_consts
assert old_encode.__code__.co_filename == new_encode.__code__.co_filename
assert old_encode.__code__.co_firstlineno == new_encode.__code__.co_firstlineno
class Replacement:
    @staticmethod
    def raw_unicode_escape_encode(text, errors):
        return b'old module', len(text)
partial.codecs = Replacement
assert partial.IncrementalEncoder().encode('A') == b'old module'
assert fresh.IncrementalEncoder().encode('A') == b'A'
print('late retry verified')
`,
    output: "late retry verified\n",
  },
  {
    name: "frozen module class creation uses the explicit input service",
    source: `
import codecs
original = codecs.Codec
events = []
class Base(original):
    def __init_subclass__(cls):
        events.append((cls.__name__, input()))
codecs.Codec = Base
try:
    import encodings.raw_unicode_escape as module
except BaseException:
    print('recovered')
    raise
assert events == [('Codec', 'annotation'), ('StreamWriter', 'annotation'), ('StreamReader', 'annotation')]
assert module.Codec.__bases__ == (Base,)
codecs.Codec = original
assert module.Codec().encode('A') == (b'A', 1)
print('import verified')
`,
    output: "import verified\n",
  },
] as const;
