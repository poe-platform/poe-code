/** Complete public programs replayed unchanged by the pinned external oracle. */
export const codecImportParentCases = [
  {
    name: "missing package path rejects an uncached owned child",
    source: `
import encodings
path = encodings.__path__
del encodings.__path__
try:
    import encodings.ascii
except ModuleNotFoundError as error:
    assert error.args == ("No module named 'encodings.ascii'; 'encodings' is not a package",)
    assert error.name == 'encodings.ascii' and error.path is None
else:
    raise AssertionError('nonpackage child was loaded')
assert 'ascii' not in encodings.__dict__
encodings.__path__ = path
import encodings.ascii
assert encodings.ascii.getregentry().name == 'ascii'
`
  },
  {
    name: "package path descriptors propagate failure and permit retry",
    source: `
import encodings
Module = type(encodings)
events = []
failure = ValueError('package path failed')
class Package(Module):
    @property
    def __path__(self):
        events.append('path')
        raise failure
encodings.__class__ = Package
try:
    import encodings.ascii
except ValueError as error:
    assert error is failure and error.args == ('package path failed',)
else:
    raise AssertionError('package path descriptor bypassed')
assert events == ['path']
assert 'ascii' not in encodings.__dict__
encodings.__class__ = Module
import encodings.ascii
assert encodings.ascii.getregentry().decode(b'A') == ('A', 1)
`
  },
  {
    name: "cached submodules bypass the parent path descriptor",
    source: `
import encodings.ascii
import encodings
child = encodings.ascii
class Package(type(encodings)):
    @property
    def __path__(self):
        raise AssertionError('cached module consulted its parent path')
encodings.__class__ = Package
import encodings.ascii as again
assert again is child
`
  },
  {
    name: "nested child errors identify the first nonpackage parent",
    source: `
import encodings.ascii
try:
    __import__('encodings.ascii.child.deep')
except ModuleNotFoundError as error:
    assert error.args == ("No module named 'encodings.ascii.child'; 'encodings.ascii' is not a package",)
    assert error.name == 'encodings.ascii.child' and error.path is None
else:
    raise AssertionError('nested nonpackage child was loaded')
`
  },
  {
    name: "missing package paths retain module lookup failure as suppressed context",
    source: `
import encodings
failure = AttributeError('path unavailable')
class Package(type(encodings)):
    @property
    def __path__(self):
        raise failure
encodings.__class__ = Package
try:
    import encodings.ascii
except ModuleNotFoundError as error:
    context = error.__context__
    assert type(context) is AttributeError and context is not failure
    assert context.args == ("module 'encodings' has no attribute '__path__'",)
    assert context.name == '__path__' and context.obj is encodings
    assert context.__context__ is None
    assert error.__cause__ is None and error.__suppress_context__ is True
    assert error.name == 'encodings.ascii' and error.path is None
else:
    raise AssertionError('missing path was accepted')
`
  },
  {
    name: "nonpackage diagnostics preserve Python name quoting",
    source: `
import encodings.ascii
for name in ("encodings.ascii.quoted'child", 'encodings.ascii.line' + chr(10)):
    try:
        __import__(name)
    except ModuleNotFoundError as error:
        assert error.args == ('No module named ' + repr(name) + "; 'encodings.ascii' is not a package",), error.args
        assert error.name == name
    else:
        raise AssertionError('nonpackage child was loaded')
`
  },
  {
    name: "module attribute failures preserve explicit fields and direct descriptor behavior",
    source: `
import codecs
Module = type(codecs)
try:
    codecs.absent
except AttributeError as error:
    assert error.name == 'absent' and error.obj is codecs
else:
    raise AssertionError('attribute unexpectedly exists')
try:
    Module.__getattribute__(codecs, 'absent')
except AttributeError as error:
    assert error.name is None and error.obj is None
else:
    raise AssertionError('attribute unexpectedly exists')
for name in (None, 'explicit'):
    target = object()
    failure = AttributeError('callback', name=name, obj=target)
    def missing(attribute):
        raise failure
    codecs.__getattr__ = missing
    try:
        codecs.absent
    except AttributeError as error:
        assert error is failure and error.name is name and error.obj is target
    else:
        raise AssertionError('callback failure was swallowed')
for target in (None, object()):
    failure = AttributeError('callback', obj=target)
    try:
        codecs.absent
    except AttributeError as error:
        assert error is failure and error.name is None and error.obj is target
    else:
        raise AssertionError('callback failure was swallowed')
`
  }
] as const;
