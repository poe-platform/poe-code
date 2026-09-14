/** Public module ownership contracts, replayable unchanged in CPython 3.14.7. */
export const codecModuleOwnershipCases = [
  {
    name: "native API namespace preserves CPython declaration order",
    source: `
import _codecs
names = [name for name in vars(_codecs) if not name.startswith('__')]
assert names == [
    'register', 'unregister', 'lookup', 'encode', 'decode',
    'escape_encode', 'escape_decode',
    'utf_8_encode', 'utf_8_decode', 'utf_7_encode', 'utf_7_decode',
    'utf_16_encode', 'utf_16_le_encode', 'utf_16_be_encode',
    'utf_16_decode', 'utf_16_le_decode', 'utf_16_be_decode', 'utf_16_ex_decode',
    'utf_32_encode', 'utf_32_le_encode', 'utf_32_be_encode',
    'utf_32_decode', 'utf_32_le_decode', 'utf_32_be_decode', 'utf_32_ex_decode',
    'unicode_escape_encode', 'unicode_escape_decode',
    'raw_unicode_escape_encode', 'raw_unicode_escape_decode',
    'latin_1_encode', 'latin_1_decode', 'ascii_encode', 'ascii_decode',
    'charmap_encode', 'charmap_decode', 'charmap_build', 'readbuffer_encode',
    'register_error', '_unregister_error', 'lookup_error',
]
`
  },
  {
    name: "native exports retain their owning module",
    source: `
import _codecs
names = ['lookup', 'register', 'unregister', 'register_error', 'lookup_error', '_unregister_error', 'encode', 'decode', 'charmap_build', 'readbuffer_encode', 'escape_encode', 'escape_decode']
for codec in ('ascii', 'latin_1', 'utf_8', 'utf_7', 'charmap'):
    for operation in ('encode', 'decode'):
        names.append(codec + '_' + operation)
for width in ('16', '32'):
    for suffix in ('', '_le', '_be'):
        for operation in ('encode', 'decode'):
            names.append('utf_' + width + suffix + '_' + operation)
    names.append('utf_' + width + '_ex_decode')
for name in names:
    function = getattr(_codecs, name)
    assert function.__self__ is _codecs, name
    assert function.__self__.__dict__[name] is function
    assert function.__name__ == function.__qualname__ == name
    assert function.__module__ == '_codecs'
    assert repr(function) == '<built-in function ' + name + '>'
`
  },
  {
    name: "module ownership survives metadata and namespace mutation",
    source: `
import _codecs
function = _codecs.ascii_encode
owner = function.__self__
metadata = []
function.__module__ = metadata
_codecs.__name__ = 'renamed'
del _codecs.ascii_encode
assert function.__self__ is owner is _codecs
assert function.__module__ is metadata
assert function.__qualname__ == function.__name__ == 'ascii_encode'
assert repr(function) == '<built-in function ascii_encode>'
assert function('A') == (b'A', 1)
import _codecs as again
assert again is owner
for remove in (False, True):
    try:
        if remove:
            del function.__self__
        else:
            function.__self__ = None
    except AttributeError as error:
        assert error.args == ("attribute '__self__' of 'builtin_function_or_method' objects is not writable",)
    else:
        assert False
assert function.__self__ is owner
descriptor = type(function).__dict__['__self__']
assert type(descriptor).__name__ == 'getset_descriptor'
assert descriptor.__name__ == '__self__'
assert descriptor.__objclass__ is type(function)
assert descriptor.__doc__ is None
assert descriptor.__get__(function, type(function)) is owner
assert descriptor.__get__(None, type(function)) is descriptor
try:
    descriptor.__get__(42)
except TypeError as error:
    assert error.args == ("descriptor '__self__' for 'builtin_function_or_method' objects doesn't apply to a 'int' object",)
else:
    assert False
`
  },
  {
    name: "standard handlers remain unbound after module publication",
    source: `
import _codecs
for name in ('strict', 'ignore', 'replace', 'backslashreplace', 'xmlcharrefreplace', 'namereplace', 'surrogatepass', 'surrogateescape'):
    handler = _codecs.lookup_error(name)
    assert handler.__self__ is None
    assert handler.__module__ is None
assert _codecs.lookup_error.__self__ is _codecs
`
  }
];
