/** Public package probes, also executed unchanged by the pinned external oracle. */
export const codecPackageAttributeCases = [
  {
    name: "a dynamic package member prevents loading an encoding module",
    source: `
import encodings
events = []
sentinel = object()
def missing(name):
    events.append(name)
    return sentinel
encodings.__getattr__ = missing
assert __import__('encodings', fromlist=['cp037']) is encodings
assert events == ['cp037'], events
assert 'cp037' not in encodings.__dict__
from encodings import cp037
assert cp037 is sentinel
assert events == ['cp037', 'cp037', 'cp037'], events
print('verified')
`
  },
  {
    name: "AttributeError permits loading while another guest exception propagates",
    source: `
import encodings
events = []
failure = ValueError('package attribute failed')
def missing(name):
    events.append(name)
    if name == 'cp037':
        raise AttributeError(name)
    raise failure
encodings.__getattr__ = missing
from encodings import cp037
assert cp037 is encodings.__dict__['cp037']
assert events == ['cp037'], events
try:
    __import__('encodings', fromlist=['cp500'])
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('package attribute failure suppressed')
assert events == ['cp037', 'cp500'], events
assert 'cp500' not in encodings.__dict__
print('verified')
`
  },
  {
    name: "package subclasses control lookup of existing dictionary members",
    source: `
import encodings
events = []
failure = ValueError('existing member failed')
Module = type(encodings)
class Package(Module):
    def __getattribute__(self, name):
        if name == 'aliases':
            events.append(name)
            raise failure
        return Module.__getattribute__(self, name)
encodings.__class__ = Package
try:
    __import__('encodings', fromlist=['aliases'])
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('package override bypassed')
assert events == ['aliases'], events
print('verified')
`
  },
  {
    name: "module class reassignment preserves namespaces and rejects incompatible layouts",
    source: `
import encodings
Module = type(encodings)
module = Module('probe')
namespace = module.__dict__
namespace['retained'] = object()
class Package(Module):
    pass
module.__class__ = Package
assert type(module) is Package and module.__dict__ is namespace
module.__class__ = Module
assert type(module) is Module and module.__dict__ is namespace
class Slotted(Module):
    __slots__ = ('extra',)
for cls, message in [
    (Slotted, "__class__ assignment: 'Slotted' object layout differs from 'module'"),
    (object, '__class__ assignment only supported for mutable types or ModuleType subclasses'),
]:
    try:
        module.__class__ = cls
    except TypeError as error:
        assert error.args == (message,), error.args
    else:
        raise AssertionError('incompatible assignment accepted')
    assert type(module) is Module and module.__dict__ is namespace
print('verified')
`
  },
  {
    name: "package lookup invokes the explicit input service before loading",
    source: `
import encodings
events = []
sentinel = object()
def missing(name):
    events.append(name)
    assert input() == 'service'
    return sentinel
encodings.__getattr__ = missing
try:
    assert __import__('encodings', fromlist=['cp037']) is encodings
except BaseException:
    print('caught')
    raise
assert events == ['cp037'], events
assert 'cp037' not in encodings.__dict__
print('verified')
`
  }
] as const;
