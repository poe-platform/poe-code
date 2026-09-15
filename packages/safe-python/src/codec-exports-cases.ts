/** Execute unchanged in PythonSession and the pinned CPython oracle. */
export const codecExportsCases = [
  {
    name: 'codecs explicit export inventory and star-import identity',
    source: `
import codecs
expected = ['register', 'lookup', 'open', 'EncodedFile', 'BOM', 'BOM_BE', 'BOM_LE', 'BOM32_BE', 'BOM32_LE', 'BOM64_BE', 'BOM64_LE', 'BOM_UTF8', 'BOM_UTF16', 'BOM_UTF16_LE', 'BOM_UTF16_BE', 'BOM_UTF32', 'BOM_UTF32_LE', 'BOM_UTF32_BE', 'CodecInfo', 'Codec', 'IncrementalEncoder', 'IncrementalDecoder', 'StreamReader', 'StreamWriter', 'StreamReaderWriter', 'StreamRecoder', 'getencoder', 'getdecoder', 'getincrementalencoder', 'getincrementaldecoder', 'getreader', 'getwriter', 'encode', 'decode', 'iterencode', 'iterdecode', 'strict_errors', 'ignore_errors', 'replace_errors', 'xmlcharrefreplace_errors', 'backslashreplace_errors', 'namereplace_errors', 'register_error', 'lookup_error']
assert type(codecs.__all__) is list
assert codecs.__all__ == expected
namespace = {}
exec('from codecs import *', namespace)
assert [key for key in namespace if key != '__builtins__'] == expected
for key in expected:
    assert namespace[key] is getattr(codecs, key)
assert 'unregister' not in namespace
assert 'BufferedIncrementalDecoder' not in namespace
assert 'ascii_encode' not in namespace
assert 'surrogatepass_errors' not in namespace
`,
  },
  {
    name: 'codecs export list mutation controls subsequent imports',
    source: `
import codecs
exports = codecs.__all__
try:
    codecs.__all__ = ['BufferedIncrementalDecoder', 'unregister']
    namespace = {}
    exec('from codecs import *', namespace)
    assert [key for key in namespace if key != '__builtins__'] == codecs.__all__
    assert namespace['BufferedIncrementalDecoder'] is codecs.BufferedIncrementalDecoder
    assert namespace['unregister'] is codecs.unregister
    codecs.__all__.append('missing_export')
    namespace = {}
    try:
        exec('from codecs import *', namespace)
    except AttributeError as error:
        assert error.args == ("module 'codecs' has no attribute 'missing_export'",)
    else:
        assert False
    assert namespace['unregister'] is codecs.unregister
finally:
    codecs.__all__ = exports
`,
  },
  {
    name: 'codecs.open declaration and argument binding',
    source: `
import codecs
function = codecs.open
assert function.__name__ == function.__qualname__ == 'open'
assert function.__module__ == 'codecs'
assert function.__defaults__ == ('r', None, 'strict', -1)
assert function.__kwdefaults__ is None
assert function.__annotations__ == {}
assert function.__code__.co_filename == '<frozen codecs>'
assert function.__code__.co_firstlineno == 886
assert function.__code__.co_argcount == 5
assert function.__code__.co_varnames == ('filename', 'mode', 'encoding', 'errors', 'buffering', 'warnings', 'file', 'info', 'srw')
for args, kwargs, message in [
    ((), {}, "open() missing 1 required positional argument: 'filename'"),
    (('a', 'r', None, 'strict', -1, None), {}, 'open() takes from 1 to 5 positional arguments but 6 were given'),
    (('a',), {'filename': 'b'}, "open() got multiple values for argument 'filename'"),
    (('a',), {'unknown': True}, "open() got an unexpected keyword argument 'unknown'"),
]:
    try:
        function(*args, **kwargs)
    except TypeError as error:
        assert error.args == (message,)
    else:
        assert False
`,
  },
  {
  "name": "codecs.open exact documentation",
  "source": "import codecs\nassert codecs.open.__doc__ == \"Open an encoded file using the given mode and return\\na wrapped version providing transparent encoding/decoding.\\n\\nNote: The wrapped version will only accept the object format\\ndefined by the codecs, i.e. Unicode objects for most builtin\\ncodecs. Output is also codec dependent and will usually be\\nUnicode as well.\\n\\nIf encoding is not None, then the\\nunderlying encoded files are always opened in binary mode.\\nThe default file mode is 'r', meaning to open the file in read mode.\\n\\nencoding specifies the encoding which is to be used for the\\nfile.\\n\\nerrors may be given to define the error handling. It defaults\\nto 'strict' which causes ValueErrors to be raised in case an\\nencoding error occurs.\\n\\nbuffering has the same meaning as for the builtin open() API.\\nIt defaults to -1 which means that the default buffer size will\\nbe used.\\n\\nThe returned wrapped file object provides an extra attribute\\n.encoding which allows querying the used encoding. This\\nattribute is only available if an encoding was specified as\\nparameter.\\n\"\n"
},
];
