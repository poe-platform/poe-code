/** Public programs run unchanged by the interpreter and external pinned oracle. */
export const propertyContractCases = [
  {
    name: "type documentation and native descriptor metadata",
    source: `
assert type(property.__doc__) is str
assert property.__doc__.startswith('Property attribute.')
assert property.__text_signature__ == '(fget=None, fset=None, fdel=None, doc=None)'
for name, signature in (
    ('__init__', '($self, /, *args, **kwargs)'),
    ('__get__', '($self, instance, owner=None, /)'),
    ('__set__', '($self, instance, value, /)'),
    ('__delete__', '($self, instance, /)'),
    ('getter', '($self, object, /)'),
    ('setter', '($self, object, /)'),
    ('deleter', '($self, object, /)'),
    ('__set_name__', '($self, owner, name, /)'),
):
    assert getattr(property, name).__text_signature__ == signature

for name in ('fget', 'fset', 'fdel', '__doc__'):
    descriptor = property.__dict__[name]
    assert type(descriptor).__name__ == 'member_descriptor'
    assert descriptor.__name__ == name
    assert descriptor.__objclass__ is property
    assert descriptor.__get__(None, property) is descriptor
for name in ('__name__', '__isabstractmethod__'):
    assert type(property.__dict__[name]).__name__ == 'getset_descriptor'
class P(property):
    'subclass doc'
assert P.__doc__ == 'subclass doc'
P.__doc__ = 42
assert P.__doc__ == 42
try:
    del P.__doc__
except TypeError as error:
    assert error.args == ("cannot delete '__doc__' attribute of immutable type 'P'",)
else:
    assert False
assert P.__text_signature__ is None
class Descriptor:
    def __get__(self, instance, owner):
        assert instance is None and owner is P
        return 'bound doc'
P.__doc__ = Descriptor()
assert P.__doc__ == 'bound doc'
class Child(P):
    pass
assert Child.__doc__ is None
`
  },
  {
    name: "descriptor precedence, accessors and class access",
    source: `
events = []
class C:
    @property
    def value(self):
        'getter doc'
        events.append('get')
        return self._value
    @value.setter
    def value(self, value):
        events.append(('set', value))
        self._value = value
        return 99
    @value.deleter
    def value(self):
        events.append('del')
        del self._value
        return 99
c = C()
c.__dict__['value'] = 'shadow'
c.value = 7
assert c.value == 7
assert C.value.__doc__ == 'getter doc'
assert C.value.__name__ == 'value'
assert C.value.__get__(None, C) is C.value
assert C.value.__get__(None, 42) is C.value
del c.value
assert events == [('set', 7), 'get', 'del']
assert c.__dict__ == {'value': 'shadow'}
assert C.value.__set__(c, 8) is None
assert C.value.__delete__(c) is None
`
  },
  {
    name: "native members, allocation and independent mutable names",
    source: `
def first(obj):
    'first doc'
    return 1
def second(obj):
    'second doc'
    return 2
p = property(first)
assert p.fget is first and p.fset is None and p.fdel is None
assert p.__name__ == 'first' and p.__doc__ == 'first doc'
p.__name__ = None
assert p.__name__ is None
del p.__name__
assert p.__name__ == 'first'
p.__set_name__(None, ['arbitrary'])
q = p.getter(second)
assert q.__name__ is p.__name__
assert q.__doc__ == 'second doc' and q.fget is second
assert p.getter(None).fget is first
p.__doc__ = 42
assert p.__doc__ == 42
del p.__doc__
assert p.__doc__ is None
for name in ('fget', 'fset', 'fdel'):
    for delete in (False, True):
        try:
            if delete:
                delattr(p, name)
            else:
                setattr(p, name, None)
        except AttributeError as error:
            assert error.args == ('readonly attribute',)
        else:
            assert False
raw = property.__new__(property, 1, 2, ignored=3)
assert raw.fget is None and raw.__doc__ is None
assert not hasattr(raw, '__name__')
assert not hasattr(raw, '__dict__')
assert raw.__isabstractmethod__ is False
property.__init__(p)
assert p.fget is None and p.__doc__ is None and not hasattr(p, '__name__')
`
  },
  {
    name: "missing accessors and arbitrary property names",
    source: `
class C:
    value = property()
c = C()
for operation in ('get', 'set', 'delete'):
    try:
        if operation == 'get':
            c.value
        elif operation == 'set':
            c.value = 1
        else:
            del c.value
    except AttributeError as error:
        suffix = {'get': 'getter', 'set': 'setter', 'delete': 'deleter'}[operation]
        assert str(error) == "property 'value' of 'C' object has no " + suffix
    else:
        assert False
p = property()
try:
    p.__get__(object())
except AttributeError as error:
    assert str(error) == "property of 'object' object has no getter"
else:
    assert False
p.__name__ = ['name']
try:
    p.__set__(None, 1)
except AttributeError as error:
    assert str(error) == "property ['name'] of 'NoneType' object has no setter"
else:
    assert False
try:
    p.__get__(None)
except TypeError as error:
    assert str(error) == '__get__(None, None) is invalid'
else:
    assert False
`
  },
  {
    name: "accessor failures retain identity and native fields bypass overrides",
    source: `
failure = ValueError('accessor failed')
def fail(*args):
    raise failure
class P(property):
    def __getattribute__(self, name):
        if name in ('fget', 'fset', 'fdel'):
            raise AssertionError('virtual accessor')
        return object.__getattribute__(self, name)
class C:
    x = P(fail, fail, fail)
c = C()
for action in (lambda: C.x.__get__(c), lambda: C.x.__set__(c, 1), lambda: C.x.__delete__(c)):
    try:
        action()
    except ValueError as error:
        assert error is failure
    else:
        assert False
`
  },
  {
    name: "subclass doc assignment, native copying and failed reinitialization",
    source: `
events = []
class P(property):
    def __setattr__(self, name, value):
        events.append((name, value))
        object.__setattr__(self, name, value)
def get(obj):
    'derived doc'
    return 1
p = P(get)
assert events == [('__doc__', 'derived doc')]
assert p.__dict__ == {'__doc__': 'derived doc'}
assert property.__dict__['__doc__'].__get__(p) is None
q = p.setter(None)
assert type(q) is P and q.fget is get
assert q.__doc__ == 'derived doc'
class Locked(property):
    __slots__ = ()
assert Locked(doc='explicit').__doc__ is None
try:
    Locked(get)
except AttributeError:
    pass
else:
    assert False
failure = ValueError('doc failed')
class Getter:
    def __getattribute__(self, name):
        raise failure
g = Getter()
try:
    property.__init__(p, g)
except ValueError as error:
    assert error is failure
else:
    assert False
assert p.fget is g and p.fset is None
assert property.__dict__['__doc__'].__get__(p) is None
`
  },
  {
    name: "abstractness resolves accessors in order with short circuit and mutation",
    source: `
events = []
failure = ValueError('abstract failed')
class Flag:
    def __bool__(self):
        events.append('truth')
        return True
class Getter:
    def __getattribute__(self, name):
        events.append(name)
        if name == '__isabstractmethod__':
            return Flag()
        raise AttributeError(name)
class Setter:
    def __getattribute__(self, name):
        raise failure
p = property(Getter(), Setter())
events.clear()
assert p.__isabstractmethod__ is True
assert events == ['__isabstractmethod__', 'truth']
p = property(None, Setter())
try:
    p.__isabstractmethod__
except ValueError as error:
    assert error is failure
else:
    assert False
`
  },
  {
    name: "copies call the actual subclass and retain post-call names",
    source: `
events = []
class P(property):
    def __new__(cls, *args):
        events.append(args)
        if len(events) > 1:
            original.__name__ = 'during copy'
        return property.__new__(cls)
def get(obj):
    'doc'
    return 1
original = P(get)
original.__name__ = 'before copy'
result = original.setter(None)
assert events == [(get,), (get, None, None, None)]
assert result.__name__ == 'during copy'
class Alternate(property):
    def __new__(cls, *args):
        if args:
            return 42
        return property.__new__(cls)
assert Alternate().getter(get) == 42
`
  }
] as const;

/** The property is invoked by the real module annotation descriptor. */
export const codecPropertyServiceSource = `
import codecs
events = []
class Spec:
    @property
    def _initializing(self):
        events.append('get')
        print(input(), flush=True)
        return False
codecs.__spec__ = Spec()
def annotate(format):
    events.append(format)
    return {'text': str}
codecs.__annotate__ = annotate
assert codecs.__annotations__ == {'text': str}
assert codecs.__annotations__ == {'text': str}
assert events == ['get', 1]
print('verified', flush=True)
`;
