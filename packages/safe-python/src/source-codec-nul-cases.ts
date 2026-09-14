/** Public programs replayed unchanged against the pinned external oracle. */
export const sourceCodecNulCases = [
  "compile(source, 'nul.py', 'exec')", "compile(source, 'nul.py', 'eval')", "eval(source)", "exec(source)"
].flatMap(operation => ["str", "bytes", "Text", "Data"].flatMap(kind => [
  "\\x00", " \\t\\x00", "# comment\\n\\x00", "1\\x00+2", "# coding: absent\\n\\x00",
  "# coding: utf8\\n#\\x00", "# coding: latin-1\\n#\\x00", "\\xef\\xbb\\xbf# coding: ascii\\n\\x00"
].map(data => ({
  name: `${operation} ${kind} ${data}`,
  source: `
import _codecs
class Text(str):
    def __str__(self):
        raise AssertionError('str override')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('bytes override')
def search(name):
    raise AssertionError('codec lookup before NUL validation')
_codecs.register(search)
source = ${kind === "str" ? `'${data}'` : kind === "bytes" ? `b'${data}'` : kind === "Text" ? `Text('${data}')` : `Data(b'${data}')`}
try:
    ${operation}
except SyntaxError as error:
    assert type(error) is SyntaxError
    assert error.args == ('source code string cannot contain null bytes',), error.args
    assert error.msg == error.args[0]
    assert (error.filename, error.lineno, error.offset, error.text, error.end_lineno, error.end_offset) == (None,) * 6
    assert error.__cause__ is None and error.__context__ is None
    assert not hasattr(error, '__notes__')
    print(type(error).__name__, error.args, str(error))
else:
    raise AssertionError('NUL source was accepted')
`
}))));

export const sourceCodecNulPrecedenceCases = ["str", "Text"].flatMap(kind => ["\\x00\\ud800", "\\udfff\\x00", " \\t\\x00\\ud800\\udfff"].map(data => ({
  name: `${kind} UTF-8 validation precedes NUL ${data}`,
  source: `
class Text(str):
    def __str__(self):
        raise AssertionError('str override')
source = ${kind === "str" ? `'${data}'` : `Text('${data}')`}
for operation in (lambda: compile(source, 'nul.py', 'exec'), lambda: eval(source), lambda: exec(source)):
    try:
        operation()
    except UnicodeEncodeError as error:
        assert error.object is source
        print(error.args, error.start, error.end, error.reason)
    else:
        raise AssertionError('surrogate source was accepted')
`
})));

export const sourceCodecSubtypeCases = ["Text", "Data"].map(kind => ({
  name: `${kind} valid source ignores conversion and buffer overrides`,
  source: `
class Text(str):
    def __str__(self):
        raise AssertionError('str override')
    def __buffer__(self, flags):
        raise AssertionError('str buffer override')
class Data(bytes):
    def __bytes__(self):
        raise AssertionError('bytes override')
    def __buffer__(self, flags):
        raise AssertionError('bytes buffer override')
expression = ${kind}(${kind === "Data" ? "b" : ""}'6 * 7')
suite = ${kind}(${kind === "Data" ? "b" : ""}'answer = 6 * 7')
assert eval(expression) == 42
code = compile(expression, 'subtype.py', 'eval')
assert code.co_filename == 'subtype.py'
assert eval(code) == 42
namespace = {}
exec(suite, namespace)
assert namespace['answer'] == 42
namespace = {}
exec(compile(suite, 'subtype.py', 'exec'), namespace)
assert namespace['answer'] == 42
print('subtype source accepted')
`
}));

export const sourceCodecNulServiceCase = {
  name: "filename services and argument failures precede NUL source validation",
  source: String.raw`
failure = ValueError('filename failed')
events = []
class Path:
    def __fspath__(self):
        events.append('path')
        assert input() == 'ready'
        if fail:
            raise failure
        return 'service.py'
for fail in (True, False):
    try:
        compile(b'# coding: absent\n\x00', Path(), 'exec')
    except ValueError as error:
        assert fail and error is failure
    except SyntaxError as error:
        assert not fail
        assert error.args == ('source code string cannot contain null bytes',)
        assert error.filename is None
    else:
        raise AssertionError('invalid source accepted')
assert events == ['path', 'path']
for flags, expected in ((-1, 'compile(): unrecognised flags'), (0, 'compile(): invalid optimize value')):
    try:
        compile('\x00', 'precedence.py', 'exec', flags, optimize=3)
    except ValueError as error:
        assert error.args == (expected,)
    else:
        raise AssertionError('invalid arguments accepted')
print('source validation ordered')
`
};
