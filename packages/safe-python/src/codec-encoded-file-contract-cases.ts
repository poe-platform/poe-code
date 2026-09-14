/** Identical programs for the guest and external CPython 3.14.7 oracle. */
export const codecEncodedFileContractCases = [
  {
    name: 'EncodedFile live globals, defaults and reflected compiler layout',
    source: `
import codecs
fn = codecs.EncodedFile
code = fn.__code__
assert fn.__globals__ is codecs.__dict__
assert fn.__kwdefaults__ is None and fn.__closure__ is None
assert fn.__annotate__ is None and fn.__annotations__ == {}
assert fn.__annotations__ is fn.__annotations__
assert code.co_name == code.co_qualname == 'EncodedFile'
assert code.co_filename == '<frozen codecs>' and code.co_firstlineno == 937
assert code.co_argcount == 4 and code.co_posonlyargcount == code.co_kwonlyargcount == 0
assert code.co_nlocals == 7 and code.co_flags == 67108867
assert code.co_varnames == ('file', 'data_encoding', 'file_encoding', 'errors', 'data_info', 'file_info', 'sr')
assert code.co_freevars == code.co_cellvars == ()
lookup = fn.__globals__.pop('lookup')
try:
    fn(None, 'utf-8')
except NameError as error:
    assert error.args == ("name 'lookup' is not defined",)
    assert error.name == 'lookup'
else:
    raise AssertionError('deleted global remained visible')
fn.__globals__['lookup'] = lookup
assert fn(None, 'utf-8').stream is None
del fn.__defaults__
assert fn.__defaults__ is None
try:
    fn(None, 'utf-8')
except TypeError as error:
    assert error.args == ("EncodedFile() missing 2 required positional arguments: 'file_encoding' and 'errors'",)
else:
    raise AssertionError('deleted defaults remained visible')
fn.__defaults__ = (None, 'strict')
assert fn(None, 'utf-8').errors == 'strict'
`,
  },
  {
    name: 'EncodedFile accepts and preserves native default-container subtypes',
    source: `
import codecs
class Defaults(tuple):
    def __len__(self):
        raise AssertionError('virtual length')
    def __getitem__(self, key):
        raise AssertionError('virtual item')
    def __iter__(self):
        raise AssertionError('virtual iteration')
class Keywords(dict):
    def __getitem__(self, key):
        raise AssertionError('virtual keyword')
fn = codecs.EncodedFile
original = fn.__defaults__
errors = object()
defaults = Defaults((None, errors))
keywords = Keywords(unused=object())
fn.__defaults__ = defaults
fn.__kwdefaults__ = keywords
assert fn.__defaults__ is defaults
assert fn.__kwdefaults__ is keywords
stream = object()
wrapped = fn(stream, 'utf-8')
assert wrapped.stream is stream and wrapped.errors is errors
assert wrapped.data_encoding == wrapped.file_encoding == 'utf-8'
fn.__defaults__ = Defaults((stream, 'utf-8', None, errors))
assert fn().stream is stream
fn.__defaults__ = original
fn.__kwdefaults__ = None

# Code replacement still uses the original function's live default containers.
code = fn.__code__
def replacement(*, errors):
    return errors
fn.__code__ = replacement.__code__
keywords = Keywords(errors=errors)
fn.__kwdefaults__ = keywords
assert fn() is errors
changed = object()
keywords['errors'] = changed
assert fn() is changed
fn.__code__ = code
fn.__kwdefaults__ = None
`,
  },
  {
    name: 'EncodedFile binding rejects invalid calls before lookup',
    source: `
import codecs
events = []
def lookup(name):
    events.append(name)
    raise AssertionError('body entered')
codecs.lookup = lookup
for args, kwargs, message in [
    ((), {}, "EncodedFile() missing 2 required positional arguments: 'file' and 'data_encoding'"),
    ((None,), {}, "EncodedFile() missing 1 required positional argument: 'data_encoding'"),
    ((None,) * 5, {}, 'EncodedFile() takes from 2 to 4 positional arguments but 5 were given'),
    ((None,), {'file': None}, "EncodedFile() got multiple values for argument 'file'"),
    ((), {'unexpected': None}, "EncodedFile() got an unexpected keyword argument 'unexpected'"),
]:
    try:
        codecs.EncodedFile(*args, **kwargs)
    except TypeError as error:
        assert error.args == (message,), error.args
    else:
        raise AssertionError('invalid binding accepted')
assert events == []
`,
  },
  {
    name: 'EncodedFile descriptor failure preserves ordered partial assignments',
    source: `
import codecs
original = codecs.lookup('utf-8')
for failing in ('encode', 'decode', 'streamreader', 'streamwriter', 'data_encoding', 'file_encoding'):
    events = []
    failure = LookupError(failing)
    class Info:
        def __getattribute__(self, name):
            events.append(name)
            if name == failing:
                raise failure
            return getattr(original, name)
    class Field:
        def __set__(self, obj, value):
            events.append(value)
            if value == failing:
                raise failure
    class Result:
        data_encoding = Field()
        file_encoding = Field()
    result = Result()
    def lookup(name):
        events.append(name)
        return Info()
    def recoder(*args):
        events.append('construct')
        return result
    codecs.lookup = lookup
    codecs.StreamRecoder = recoder
    try:
        codecs.EncodedFile(object(), 'data_encoding', 'file_encoding')
    except LookupError as error:
        assert error is failure
        assert error.args == (failing,)
        assert not hasattr(error, '__notes__')
    else:
        raise AssertionError('failure lost')
    expected = ['data_encoding', 'file_encoding', 'encode', 'decode', 'streamreader', 'streamwriter', 'construct', 'data_encoding', 'file_encoding']
    index = expected.index(failing, 2)
    assert events == expected[:index + 1], events
`,
  },
];

codecEncodedFileContractCases.push({"name":"EncodedFile exact documentation","source":"import codecs\nassert codecs.EncodedFile.__doc__ == \"Return a wrapped version of file which provides transparent\\nencoding translation.\\n\\nData written to the wrapped file is decoded according\\nto the given data_encoding and then encoded to the underlying\\nfile using file_encoding. The intermediate data type\\nwill usually be Unicode but depends on the specified codecs.\\n\\nBytes read from the file are decoded using file_encoding and then\\npassed back to the caller encoded using data_encoding.\\n\\nIf file_encoding is not given, it defaults to data_encoding.\\n\\nerrors may be given to define the error handling. It defaults\\nto 'strict' which causes ValueErrors to be raised in case an\\nencoding error occurs.\\n\\nThe returned wrapped file object provides two extra attributes\\n.data_encoding and .file_encoding which reflect the given\\nparameters of the same name. The attributes can be used for\\nintrospection by Python programs.\\n\\n\"\n"});
