/** Run unchanged through PythonSession and the pinned CPython external oracle. */
export const codecRelativeImportCases = [
  {name: "package-relative imports return the requested module and preserve registry identities", source: `
import codecs
import encodings
import encodings.ascii as ascii
import encodings.aliases as aliases
namespace = {'__package__': 'encodings'}
assert __import__('ascii', namespace, None, (), 1) is ascii
assert __import__('ascii', namespace, None, ('Codec',), 1) is ascii
assert __import__('', namespace, None, (), 1) is encodings
assert __import__('', namespace, None, ('aliases',), 1) is encodings
assert __import__('aliases', {'__package__': 'encodings.child'}, None, (), 2) is aliases
assert codecs.lookup('ascii').encode is ascii.Codec.encode
__package__ = 'encodings'
from . import latin_1
from .utf_8 import getregentry
assert latin_1.getregentry().name == 'iso8859-1'
assert getregentry().name == 'utf-8'
`},
  {name: "native globals and package payloads bypass dictionary and string overrides", source: `
import encodings.ascii as ascii
class Namespace(dict):
    def __getitem__(self, key):
        raise AssertionError('virtual dictionary access')
    def __contains__(self, key):
        raise AssertionError('virtual dictionary membership')
class Package(str):
    def __str__(self):
        raise AssertionError('virtual package conversion')
    def rsplit(self, *args):
        raise AssertionError('virtual package splitting')
assert __import__('ascii', Namespace(__package__=Package('encodings')), level=1) is ascii
`},
  {name: "spec parent descriptors retain exceptions and retry with live metadata", source: `
import encodings.ascii as ascii
events = []
failure = ValueError('parent failure')
class Spec:
    @property
    def parent(self):
        events.append('parent')
        if len(events) == 1:
            raise failure
        return 'encodings'
namespace = {'__spec__': Spec()}
try:
    __import__('ascii', namespace, level=1)
except ValueError as caught:
    assert caught is failure
else:
    assert False
assert __import__('ascii', namespace, level=1) is ascii
assert events == ['parent', 'parent']
`},
  {name: "relative import validation preserves exact exception arguments", source: `
class Spec:
    parent = 42
for namespace, level, kind, message in (
    (None, 1, TypeError, 'globals must be a dict'),
    ([], 1, TypeError, 'globals must be a dict'),
    ({'__package__': 42}, 1, TypeError, 'package must be a string'),
    ({'__spec__': Spec()}, 1, TypeError, '__spec__.parent must be a string'),
    ({'__package__': ''}, 1, ImportError, 'attempted relative import with no known parent package'),
    ({'__package__': 'encodings'}, 2, ImportError, 'attempted relative import beyond top-level package'),
    ({'__package__': 'encodings'}, 2147483647, ImportError, 'attempted relative import beyond top-level package'),
):
    try:
        __import__('ascii', namespace, level=level)
    except kind as error:
        assert error.args == (message,), error.args
    else:
        assert False
try:
    __import__('missing_relative_codec', {'__package__': 'encodings'}, level=1)
except ModuleNotFoundError as error:
    assert error.name == 'encodings.missing_relative_codec'
    assert error.args == ("No module named 'encodings.missing_relative_codec'",)
else:
    assert False
`},
  {name: "package comparison uses guest equality before loading", source: `
import encodings.ascii as ascii
events = []
class Package(str):
    def __eq__(self, other):
        events.append(('compare', other))
        return True
class Spec:
    @property
    def parent(self):
        events.append('parent')
        return 'different'
assert __import__('ascii', {'__package__': Package('encodings'), '__spec__': Spec()}, level=1) is ascii
assert events == ['parent', ('compare', 'different')]
`},
  {name: "name and level validation follow native argument precedence", source: `
for name, level, kind, message in (
    (123, -1, TypeError, 'module name must be a string'),
    (123, 2147483648, OverflowError, 'Python int too large to convert to C int'),
    (123, -2147483649, OverflowError, 'Python int too large to convert to C int'),
    ('', -1, ValueError, 'level must be >= 0'),
    ('', 0, ValueError, 'Empty module name'),
):
    try:
        __import__(name, level=level)
    except kind as error:
        assert error.args == (message,), error.args
    else:
        assert False
try:
    __import__('ascii', level=1)
except KeyError as error:
    assert error.args == ("'__name__' not in globals",)
else:
    assert False
`},
  {name: "package fallback uses native name and path presence", warnings: Array.from({length: 6}, () => ({category: "ImportWarning", message: "can't resolve package from __spec__ or __package__, falling back on __name__ and __path__"})), source: `
import encodings.ascii as ascii
for namespace in (
    {'__name__': 'encodings.child'},
    {'__name__': 'encodings', '__path__': None},
    {'__package__': None, '__spec__': None, '__name__': 'encodings.child'},
):
    assert __import__('ascii', namespace, level=1) is ascii
for namespace, kind, message in (
    ({}, KeyError, "'__name__' not in globals"),
    ({'__name__': 42}, TypeError, '__name__ must be a string'),
    ({'__name__': 'top'}, ImportError, 'attempted relative import with no known parent package'),
    ({'__package__': '.'}, ImportError, 'attempted relative import beyond top-level package'),
):
    try:
        __import__('ascii', namespace, level=3 if '__package__' in namespace else 1)
    except kind as error:
        assert error.args == (message,), error.args
    else:
        assert False
`},
  {name: "relative spec callbacks can perform service I/O", source: `
import encodings.ascii as ascii
class Spec:
    @property
    def parent(self):
        print('parent')
        return input()
assert __import__('ascii', {'__spec__': Spec()}, level=1) is ascii
print('verified')
`}
] as const;
