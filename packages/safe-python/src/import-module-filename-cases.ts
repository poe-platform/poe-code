/** Public import programs shared with the pinned external oracle. */
export const importModuleFilenameCases = [{
  name: "native module filename and original subtype identity",
  source: `
import codecs
class Path(str):
    def __str__(self):
        return '/visible/subtype.py'
Module = type(codecs)
for path in ('/guest/probe.py', '', Path('/guest/subtype.py'), None, 42):
    module = Module('probe')
    module.__file__ = path
    __builtins__['__import__'] = lambda *args: module
    try:
        from probe import absent
    except ImportError as error:
        if isinstance(path, str):
            assert error.args == ("cannot import name 'absent' from 'probe' (" + str(path) + ")",)
            assert error.path is path
        else:
            assert error.args == ("cannot import name 'absent' from 'probe' (unknown location)",)
            assert error.path is None
        assert error.name == 'probe' and error.name_from == 'absent'
    else:
        assert False
`
}, {
  name: "deleted module spec disables filename fallback",
  source: `
import codecs
module = type(codecs)('probe')
module.__file__ = '/guest/probe.py'
del module.__spec__
__builtins__['__import__'] = lambda *args: module
try:
    from probe import absent
except ImportError as error:
    assert error.args == ("cannot import name 'absent' from 'probe' (unknown location)",)
    assert error.path is None
else:
    assert False
`
}, {
  name: "native filename bypasses module subclass attribute overrides",
  source: `
import codecs
events = []
class Module(type(codecs)):
    def __getattribute__(self, name):
        events.append(name)
        if name == '__file__':
            raise AssertionError('virtual filename lookup')
        return super().__getattribute__(name)
module = Module('probe')
module.__file__ = '/guest/probe.py'
__builtins__['__import__'] = lambda *args: module
try:
    from probe import absent
except ImportError as error:
    assert error.args == ("cannot import name 'absent' from 'probe' (/guest/probe.py)",)
    assert error.path == '/guest/probe.py'
    assert events == ['absent', '__name__', '__spec__']
else:
    assert False
`
}, {
  name: "spec origin precedes native filename and initializing status",
  source: `
import codecs
events = []
class Spec:
    def __getattribute__(self, name):
        events.append(name)
        if name == 'has_location':
            return True
        if name == 'origin':
            return '/guest/origin.py'
        if name == '_initializing':
            return True
        raise AttributeError(name)
module = type(codecs)('probe')
module.__file__ = '/guest/filename.py'
module.__spec__ = Spec()
__builtins__['__import__'] = lambda *args: module
try:
    from probe import absent
except ImportError as error:
    assert error.args == ("cannot import name 'absent' from partially initialized module 'probe' (most likely due to a circular import) (/guest/origin.py)",)
    assert error.path == '/guest/origin.py'
    assert events == ['has_location', 'origin', '_initializing']
else:
    assert False
`
}, {
  name: "filename formatting propagates guest failure identity",
  source: `
import codecs
failure = ValueError('filename formatting')
class Path(str):
    def __str__(self):
        raise failure
module = type(codecs)('probe')
module.__file__ = Path('/guest/probe.py')
__builtins__['__import__'] = lambda *args: module
try:
    from probe import absent
except ValueError as error:
    assert error is failure
else:
    assert False
`
}];
