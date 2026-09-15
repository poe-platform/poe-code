/** Unchanged public programs shared with the pinned differential oracle. */
export const codecPackageFromlistCases = [
  {name: "rejects non-string members after loading preceding members", source: `
import encodings
try:
    __import__('encodings', fromlist=['cp037', 1, 'cp500'])
except TypeError as error:
    assert error.args == ("Item in " + chr(96) * 2 + "from list'' must be str, not int",), error.args
else:
    raise AssertionError('non-string accepted')
assert 'cp037' in encodings.__dict__
assert 'cp500' not in encodings.__dict__
print('verified')
`},
  {name: "expands all once and resumes the outer iterator", source: `
import encodings
encodings.__all__ = ['cp037', '*', 'cp500']
assert __import__('encodings', fromlist=['*', 'cp850']) is encodings
for name in ['cp037', 'cp500', 'cp850']:
    assert name in encodings.__dict__, name
print('verified')
`},
  {name: "reads dynamic all twice and preserves failure identity", source: `
import encodings
events = []
failure = ValueError('all failed')
def missing(name):
    events.append(name)
    if len(events) == 1:
        return ['cp037']
    raise failure
encodings.__getattr__ = missing
try:
    __import__('encodings', fromlist=['*'])
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('second lookup skipped')
assert events == ['__all__', '__all__'], events
assert 'cp037' not in encodings.__dict__
print('verified')
`},
  {name: "recursive diagnostics use live package and guest type names", source: `
import encodings
class Bad:
    pass
Bad.__name__ = 'Renamed'
encodings.__name__ = 'renamed_package'
encodings.__all__ = [Bad()]
try:
    __import__('encodings', fromlist=['*'])
except TypeError as error:
    assert error.args == ('Item in renamed_package.__all__ must be str, not Renamed',), error.args
else:
    raise AssertionError('invalid all accepted')
print('verified')
`},
  {name: "string subclass equality controls expansion", source: `
import encodings
events = []
class Star(str):
    def __eq__(self, other):
        events.append(other)
        return True
encodings.__all__ = ['cp037']
assert __import__('encodings', fromlist=[Star('anything')]) is encodings
assert events == ['*'], events
assert 'cp037' in encodings.__dict__
print('verified')
`},
  {name: "nonpackages skip member validation and packages without all skip expansion", source: `
import codecs, encodings
assert __import__('codecs', fromlist=[1]) is codecs
assert __import__('encodings', fromlist=['*']) is encodings
assert 'cp037' not in encodings.__dict__
print('verified')
`},
  {name: "all remains a live iterable and ignores its own truth value", source: `
import encodings
events = []
class Members:
    def __bool__(self):
        raise AssertionError('all truth tested')
    def __iter__(self):
        events.append('iter')
        return iter(['aliases'])
encodings.__all__ = Members()
assert __import__('encodings', fromlist=['*', '*']) is encodings
assert events == ['iter', 'iter'], events
encodings.__all__ = None
try:
    __import__('encodings', fromlist=['*'])
except TypeError as error:
    assert error.args == ("'NoneType' object is not iterable",), error.args
else:
    raise AssertionError('noniterable all accepted')
print('verified')
`},
  {name: "recursive diagnostics add to the package name before querying the type", source: `
import encodings
events = []
class Name(str):
    def __add__(self, other):
        events.append(other)
        return 'custom_location'
class Meta(type):
    def __getattribute__(self, name):
        if name == '__name__':
            events.append(name)
            return 'custom_type'
        return type.__getattribute__(self, name)
class Bad(metaclass=Meta):
    pass
encodings.__name__ = Name('original')
encodings.__all__ = [Bad()]
try:
    __import__('encodings', fromlist=['*'])
except TypeError as error:
    assert error.args == ('Item in custom_location must be str, not custom_type',), error.args
else:
    raise AssertionError('invalid all accepted')
assert events == ['.__all__', '__name__'], events
print('verified')
`},
  {name: "child discovery uses the live package name and permits retry", source: `
import encodings
encodings.__name__ = 'encodings.aliases'
assert __import__('encodings', fromlist=['cp037']) is encodings
assert 'cp037' not in encodings.__dict__
encodings.__name__ = 'encodings'
assert __import__('encodings', fromlist=['cp037']) is encodings
assert 'cp037' in encodings.__dict__
print('verified')
`},
  {name: "child names use guest formatting after attribute lookup", source: `
import encodings
events = []
class Member(str):
    def __format__(self, spec):
        events.append(spec)
        return 'cp037'
member = Member('missing_child')
assert __import__('encodings', fromlist=[member]) is encodings
assert events == [''], events
assert 'cp037' in encodings.__dict__
assert 'missing_child' not in encodings.__dict__
print('verified')
`},
  {name: "child name formatting failure preserves identity", source: `
import encodings
failure = ValueError('format failed')
class Name(str):
    def __format__(self, spec):
        raise failure
encodings.__name__ = Name('encodings')
try:
    __import__('encodings', fromlist=['cp037'])
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('format bypassed')
assert 'cp037' not in encodings.__dict__
print('verified')
`},
  {name: "recursive iteration calls the explicit input service", source: `
import encodings
class Members:
    def __iter__(self):
        assert input() == 'service'
        return iter(['cp037'])
encodings.__all__ = Members()
assert __import__('encodings', fromlist=['*']) is encodings
assert 'cp037' in encodings.__dict__
print('verified')
`}
] as const;
