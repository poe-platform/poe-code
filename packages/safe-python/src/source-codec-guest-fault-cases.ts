/** Executed unchanged with the real guest runtime and pinned external oracle.
 * trigger() invokes byte-source compilation using decode() as a registered codec. */
export const sourceCodecGuestFaultCases = [
  ...["ValueError", "LookupError", "IndexError", "UnicodeError"].map(base => ({name: `${base} live string protocol`, source: `
events = []
class Text(str):
    pass
message = Text('fault\\ud800\\udc00🐍')
class Failure(${base}):
    def __str__(self):
        events.append('str')
        return message
failure = Failure('original')
def decode():
    raise failure
try:
    trigger()
except SyntaxError as error:
    assert type(error) is SyntaxError
    assert error.msg is message
    assert error.args == (message, (target, 0, -1, None))
    assert error.args[0] is error.msg
    assert error.filename == target
    if preserve_filename:
        assert error.filename is target
    assert (error.lineno, error.offset, error.text, error.end_lineno, error.end_offset) == (0, -1, None, None, None)
    assert error.__context__ is None
else:
    assert False
assert events == ['str']
assert failure.args == ('original',)
`})),
  {name: "KeyError renders the original key through guest repr", source: `
events = []
class Key:
    def __repr__(self):
        events.append('repr')
        return 'key\\ud800\\udc00'
key = Key()
failure = KeyError(key)
def decode():
    raise failure
try:
    trigger()
except SyntaxError as error:
    assert error.msg == 'key\\ud800\\udc00'
    assert error.filename == target
    if preserve_filename:
        assert error.filename is target
else:
    assert False
assert events == ['repr']
assert failure.args[0] is key
`},
  {name: "SyntaxError updates filename using the live setter and retains args", source: `
events = []
class Failure(SyntaxError):
    def __setattr__(self, name, value):
        events.append((name, value))
        super().__setattr__(name, value)
failure = Failure('old', ('before.py', 7, 4, 'line', 8, 5))
arguments = failure.args
def decode():
    raise failure
try:
    trigger()
except SyntaxError as error:
    assert error is failure
    assert error.args is arguments
    assert error.filename == target
    if preserve_filename:
        assert error.filename is target
    assert (error.lineno, error.offset, error.text, error.end_lineno, error.end_offset) == (7, 4, 'line', 8, 5)
else:
    assert False
assert events == [('__notes__', ["decoding with 'guest-fault' codec failed"]), ('filename', target)]
`},
  {name: "rendering failure propagates without a second translation", source: `
events = []
replacement = IndexError('render failed')
class Failure(ValueError):
    def __str__(self):
        events.append('str')
        raise replacement
failure = Failure('original')
def decode():
    raise failure
try:
    trigger()
except IndexError as error:
    assert error is replacement
    assert error.__context__ is None
else:
    assert False
assert events == ['str']
`},
  {name: "invalid str return is a TypeError", source: `
class Failure(ValueError):
    def __str__(self):
        return 7
def decode():
    raise Failure('original')
try:
    trigger()
except TypeError as error:
    assert error.args == ('__str__ returned non-string (type int)',)
else:
    assert False
`},
  {name: "untranslated exceptions preserve identity without rendering", source: `
class Failure(TypeError):
    def __str__(self):
        raise AssertionError('must not render')
failure = Failure('original')
def decode():
    raise failure
try:
    trigger()
except TypeError as error:
    assert error is failure
else:
    assert False
`},
  {name: "filename setter failures preserve identity", source: `
replacement = LookupError('setter failed')
class Failure(SyntaxError):
    def __setattr__(self, name, value):
        if name == 'filename':
            raise replacement
        super().__setattr__(name, value)
failure = Failure('old')
def decode():
    raise failure
try:
    trigger()
except LookupError as error:
    assert error is replacement
    assert error.__context__ is None
else:
    assert False
`},
  ...['render', 'filename'].map(phase => ({name: `${phase} callback bare raise preserves caller handled exception`, source: `
outer = RuntimeError('caller')
${phase === 'render' ? `class Failure(ValueError):
    def __str__(self):
        raise
failure = Failure('decoder')` : `class Failure(SyntaxError):
    def __setattr__(self, name, value):
        if name == 'filename':
            raise
        super().__setattr__(name, value)
failure = Failure('decoder')`}
def decode():
    raise failure
try:
    raise outer
except RuntimeError:
    try:
        trigger()
    except RuntimeError as error:
        assert error is outer
        assert error.__context__ is None
    else:
        assert False
    try:
        raise
    except RuntimeError as error:
        assert error is outer
assert failure.__context__ is outer
`})),
  {name: 'translated source error chains caller without inheriting decoder cause', source: `
outer = RuntimeError('caller')
cause = TypeError('decoder cause')
failure = ValueError('decoder')
def decode():
    raise failure from cause
try:
    raise outer
except RuntimeError:
    try:
        trigger()
    except SyntaxError as error:
        assert error.__context__ is outer
        assert error.__cause__ is None
        assert error.__suppress_context__ is False
    else:
        assert False
assert failure.__context__ is outer
assert failure.__cause__ is cause
assert failure.__suppress_context__ is True
`},
  {name: 'reentrant source rendering restores caller context', source: `
outer = RuntimeError('caller')
inner = LookupError('inner')
events = []
class Failure(ValueError):
    def __str__(self):
        global decode
        def decode():
            raise inner
        try:
            trigger()
        except SyntaxError as error:
            assert error.msg == 'inner'
            assert error.__context__ is outer
            events.append('inner')
        return 'outer rendering'
failure = Failure('decoder')
def decode():
    raise failure
try:
    raise outer
except RuntimeError:
    try:
        trigger()
    except SyntaxError as error:
        assert error.msg == 'outer rendering'
        assert error.__context__ is outer
        events.append('outer')
    else:
        assert False
assert events == ['inner', 'outer']
assert failure.__context__ is outer
assert inner.__context__ is outer
`}
];
