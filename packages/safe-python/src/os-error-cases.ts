/** Public programs shared unchanged with the external pinned interpreter. */
export const osErrorCases=[
  {name:"native family, aliases, argument parsing and errno selection",source:`
assert EnvironmentError is OSError and IOError is OSError
families = {1: PermissionError, 2: FileNotFoundError, 3: ProcessLookupError, 4: InterruptedError, 10: ChildProcessError, 13: PermissionError, 17: FileExistsError, 20: NotADirectoryError, 21: IsADirectoryError, 32: BrokenPipeError, 35: BlockingIOError, 36: BlockingIOError, 37: BlockingIOError, 53: ConnectionAbortedError, 54: ConnectionResetError, 58: BrokenPipeError, 60: TimeoutError, 61: ConnectionRefusedError, 107: PermissionError}
for number in range(-2, 130):
    error = OSError(number, 'message')
    assert type(error) is families.get(number, OSError), number
    assert error.args == (number, 'message')
    assert (error.errno, error.strerror, error.filename, error.filename2) == (number, 'message', None, None)
    assert str(error) == '[Errno ' + str(number) + '] message'
    assert not hasattr(error, 'winerror')
    assert not hasattr(error, 'characters_written')
for cls in (OSError, BlockingIOError, ConnectionError, ChildProcessError, BrokenPipeError, ConnectionAbortedError, ConnectionRefusedError, ConnectionResetError, FileExistsError, FileNotFoundError, IsADirectoryError, NotADirectoryError, InterruptedError, PermissionError, ProcessLookupError, TimeoutError):
    assert issubclass(cls, OSError)
    assert type(cls(2, 'message')) is (FileNotFoundError if cls is OSError else cls)
    for length in range(8):
        args = tuple(range(length))
        error = cls(*args)
        print(cls.__name__, length, type(error).__name__, error.args, error.errno, error.strerror, error.filename, error.filename2, getattr(error, 'characters_written', None), str(error), repr(error), error.__reduce__())
`},
  {name:"native member mutation, reduction and written count conversion",source:`
error = OSError(2, 'missing', 'first', 'ignored', 'second')
assert error.args == (2, 'missing')
assert error.__reduce__() == (FileNotFoundError, (2, 'missing', 'first', None, 'second'))
assert str(error) == "[Errno 2] missing: 'first' -> 'second'"
for name in ('errno', 'strerror', 'filename', 'filename2'):
    setattr(error, name, None)
assert str(error) == '[Errno None] None: None -> None'
for name in ('errno', 'strerror', 'filename', 'filename2'):
    delattr(error, name)
assert str(error) == "(2, 'missing')"
assert (error.errno, error.strerror, error.filename, error.filename2) == (None, None, None, None)
assert error.__reduce__() == (FileNotFoundError, error.args)
dictionary = error.__dict__
assert error.__reduce__()[2] is dictionary
events = []
class Index:
    def __index__(self):
        events.append('index')
        return 9
error.characters_written = Index()
assert error.characters_written == 9 and events == ['index']
del error.characters_written
assert not hasattr(error, 'characters_written')
for value in (-2, -1, 0, 2**63-1):
    error.characters_written = value
    assert getattr(error, 'characters_written', None) == (None if value == -1 else value)
for value in (2**63, -2**63-1):
    try:
        error.characters_written = value
    except ValueError as caught:
        print(type(caught).__name__, caught.args)
    else:
        raise AssertionError('overflow')
for value in (1.5, 'x', None):
    try:
        error.characters_written = value
    except TypeError as caught:
        print(type(caught).__name__, caught.args)
    else:
        raise AssertionError('index validation')
assert error.characters_written == 2**63-1
`},
  {name:"subclass deferred initialization and numeric filename protocols",source:`
class Custom(OSError):
    def __init__(self, *args, **kwargs):
        assert self.args == ()
        assert self.errno is None
        super().__init__(2, 'missing', 'path')
error = Custom(1, bad=True)
assert error.args == (2, 'missing') and error.filename == 'path'
assert type(error) is Custom
class Both(OSError):
    def __new__(cls, *args):
        return super().__new__(cls, 3, 'gone')
    def __init__(self, *args):
        assert self.args == (3, 'gone')
assert Both(1).errno == 3
error = OSError(2, 'old', 'path')
OSError.__init__(error, 3, 'new', ignored=True)
assert error.args == (2, 'old') and error.errno == 2
class Index:
    def __index__(self):
        return 7
value = Index()
error = BlockingIOError(35, 'blocked', value)
assert error.characters_written == 7
assert error.args[2] is value and error.filename is None
class Child(BlockingIOError):
    pass
error = Child(35, 'blocked', value)
assert error.filename is value and error.args == (35, 'blocked')
assert not hasattr(error, 'characters_written')
for value in (1.5, 2**63, -2**63-1):
    try:
        BlockingIOError(35, 'blocked', value)
    except (TypeError, ValueError) as caught:
        print(type(caught).__name__, caught.args)
    else:
        raise AssertionError('numeric filename')
`}
  ,{name:"numeric filename membership and exact descriptor metadata",source:`
for value in (1j, 1.5, 'x', [], {}, None):
    try:
        error = BlockingIOError(35, 'blocked', value)
    except TypeError as error:
        print(type(value).__name__, error.args)
    else:
        print(type(value).__name__, error.args, error.filename)
print(sorted(OSError.__dict__))
for name in sorted(OSError.__dict__):
    item = OSError.__dict__[name]
    if name != '__doc__':
        print(name, type(item).__name__, getattr(item, '__name__', None), getattr(item, '__qualname__', None), getattr(item, '__objclass__', None), getattr(item, '__text_signature__', None), getattr(item, '__doc__', None))
for cls in (OSError, BlockingIOError, FileNotFoundError):
    try:
        cls(code=1)
    except TypeError as error:
        print(error.args)
class Custom(OSError):
    pass
try:
    Custom(code=1)
except TypeError as error:
    print(error.args)
try:
    BaseException.__new__(OSError)
except TypeError as error:
    print(error.args)
`},
  {name:"errno hash callbacks and deferred reinitialization mutation",source:`
events = []
class Number(int):
    def __hash__(self):
        events.append('hash')
        return hash(2)
    def __eq__(self, other):
        events.append(('eq', other))
        return True
number = Number(12345)
error = OSError(number, 'message')
assert type(error) is FileNotFoundError and error.errno is number
assert events == ['hash', ('eq', 2)], events
events.clear()
class Custom(OSError):
    def __init__(self, *args):
        super().__init__(*args)
error = Custom(2, 'message', 'first', None, 'second')
error.characters_written = 7
error.__init__(3, 'new')
assert (error.errno, error.strerror, error.filename, error.filename2, error.characters_written) == (3, 'new', 'first', 'second', 7)
error.__init__('single')
assert (error.errno, error.strerror, error.filename, error.filename2, error.characters_written) == (None, None, 'first', 'second', 7)
assert error.args == ('single',)
error.__init__(4, 'again', 'other')
assert error.filename2 == 'second'
assert error.__reduce__() == (Custom, (4, 'again', 'other', None, 'second'))
`}
  ,{name:"starred argument tuple identity across native and deferred allocation",source:`
for args in ((1, 'message'), (1, 'message', None), (1, 'message', None, None, 'ignored'), tuple(range(6))):
    assert OSError(*args).args is args
    assert OSError(*args, **{}).args is args
    assert OSError.__new__(OSError, *args).args is not args
args = (1, 'message', 'path')
assert OSError(*args).args == args[:2]
assert OSError(*args).args is not args
class Custom(OSError):
    def __init__(self, *args):
        super().__init__(*args)
        self.original = args
error = Custom(1, 'message')
assert error.args is error.original
class Tuple(tuple):
    def __iter__(self):
        return iter((2, 'replacement'))
args = Tuple((1, 'message'))
assert OSError(*args).args == (2, 'replacement')
assert type(OSError(*args).args) is tuple
`}
] as const;

export const osErrorServiceCases=[
  {name:"errno hash suspension and recursive construction",source:`
events = []
class Number(int):
    def __hash__(self):
        assert input() == 'service'
        inner = OSError(35, 'inner', 8)
        events.append(inner.characters_written)
        return hash(2)
number = Number(2)
error = OSError(number, 'missing', 'path')
assert type(error) is FileNotFoundError and error.errno is number
assert events == [8]
print('hash verified')
`,output:"hash verified\n"},
  {name:"written count suspension and recursive mutation",source:`
error = OSError()
class Index:
    def __index__(self):
        assert input() == 'service'
        error.characters_written = 3
        assert OSError(35, 'inner', 8).characters_written == 8
        return 9
error.characters_written = Index()
assert error.characters_written == 9
print('index verified')
`,output:"index verified\n"},
  {name:"representation suspension retains native argument references",source:`
class Number:
    def __str__(self):
        assert input() == 'service'
        error.strerror = 'changed'
        error.filename = 'changed'
        assert str(OSError(3, 'inner')) == '[Errno 3] inner'
        return 'number'
error = OSError(Number(), 'original', 'path')
assert str(error) == "[Errno number] original: 'path'"
assert error.strerror == 'changed' and error.filename == 'changed'
print('representation verified')
`,output:"representation verified\n"}
] as const;
