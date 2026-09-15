/** Unchanged public programs for the pinned Darwin CPython 3.14.7 oracle. */
export const codecPlatformModuleCases = [
  ...["mbcs", "oem"].map(name => ({
    name: `${name} import failure and registry cache`,
    source: `
import codecs
import encodings
for attempt in range(2):
    try:
        import encodings.${name}
    except ImportError as error:
        assert type(error) is ImportError
        assert error.args == ("cannot import name '${name}_encode' from 'codecs' (" + codecs.__file__ + ")",)
        assert error.name == 'codecs'
        assert error.path == codecs.__file__
        assert error.name_from == '${name}_encode'
        assert error.__context__ is None and error.__cause__ is None
    else:
        assert False
    assert not hasattr(encodings, '${name}')
    try:
        codecs.lookup('${name}')
    except LookupError as error:
        assert type(error) is LookupError
        assert error.args == ('unknown encoding: ${name}',)
    else:
        assert False
assert encodings._cache['${name}'] is None
`
  })),
  {
    name: "Windows code-page factory imports lazily and preserves argument precedence",
    source: `
import codecs
import encodings
import encodings._win_cp_codecs as module
from encodings._win_cp_codecs import create_win32_code_page_codec as create
assert encodings._win_cp_codecs is module
assert module.codecs is codecs
assert create is module.create_win32_code_page_codec
assert create.__module__ == 'encodings._win_cp_codecs'
assert create.__name__ == create.__qualname__ == 'create_win32_code_page_codec'
assert create.__defaults__ is None and create.__kwdefaults__ is None
assert module.__doc__ is None
assert module.__package__ == 'encodings'
for cp in (0, 65001, None, object()):
    try:
        create(cp)
    except ImportError as error:
        assert type(error) is ImportError
        assert error.args == ("cannot import name 'code_page_encode' from 'codecs' (" + codecs.__file__ + ")",)
        assert error.name == 'codecs' and error.path == codecs.__file__
        assert error.name_from == 'code_page_encode'
    else:
        assert False
try:
    create()
except TypeError as error:
    assert error.args == ("create_win32_code_page_codec() missing 1 required positional argument: 'cp'",)
else:
    assert False
import encodings._win_cp_codecs as again
assert again is module
`
  }
];

export const codecPlatformServiceCases = [{
  name: "platform module import preserves a serviced guest failure",
  source: `
import codecs
failure = ValueError('attribute service')
def missing(name):
    assert name == '__path__'
    assert input() == 'service'
    raise failure
codecs.__getattr__ = missing
try:
    import encodings.mbcs
except ValueError as error:
    assert error is failure
else:
    assert False
print('verified')
`
}, {
  name: "import error filename formatting uses the supplied input service",
  source: `
import codecs
class Path(str):
    def __str__(self):
        return input()
module = type(codecs)('probe')
path = Path('/guest/probe.py')
module.__file__ = path
__builtins__['__import__'] = lambda *args: module
try:
    from probe import absent
except ImportError as error:
    assert error.args == ("cannot import name 'absent' from 'probe' (service)",)
    assert error.path is path
else:
    assert False
print('verified')
`
}];
