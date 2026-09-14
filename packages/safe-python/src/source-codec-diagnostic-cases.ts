/** Complete guest programs, replayed unchanged against the pinned oracle. */
export const sourceCodecBomCases = ["exec", "eval"].flatMap(mode =>
  ["", "# first\n"].map(prefix => ({
    name: `${mode} BOM conflicts on line ${prefix === "" ? 1 : 2}`,
    source: `
for comment in (b'# coding: latin-1', b'# coding: utf8', b'# \\xc3\\xa9 coding: ascii', b'# \\xff coding: ascii'):
    for ending in (b'\\n', b'\\r', b'\\r\\n'):
        source = b'\\xef\\xbb\\xbf' + ${JSON.stringify(prefix)}.encode() + comment + ending + b'1'
        try:
            compile(source, 'cookie.py', '${mode}')
        except SyntaxError as error:
            print(type(error).__name__, repr(error.args))
            print(repr((error.filename, error.lineno, error.offset, error.end_lineno, error.end_offset, error.text)))
            arguments = error.args
            error.filename = 'changed.py'
            assert error.args is arguments
        else:
            raise AssertionError('conflicting BOM was accepted')
`
  }))
);

export const sourceCodecDecodingCases = ["exec", "eval"].map(mode => ({
  name: `${mode} byte source decoding failures`,
  source: String.raw`
for prefix in (b'', b'\xef\xbb\xbf', b'# coding: utf-8\n', b'# coding: utf8\n', b'# coding: ascii\n'):
    for separator in (b'\n', b'\r', b'\r\n'):
        for bad in (b'\xff', b'\xc3', b'\xed\xa0\x80', b'\xf4\x90\x80\x80', b'\xe2\x82'):
            source = prefix + b'# first' + separator + b'# \xc3\xa9\xf0\x9f\x90\x8d' + bad + separator + b'1'
            try:
                compile(source, 'decode.py', '${mode}')
            except SyntaxError as error:
                print(type(error).__name__, repr(error.args))
                print(repr((error.filename, error.lineno, error.offset, error.end_lineno, error.end_offset, error.text)))
            else:
                raise AssertionError('invalid source bytes were accepted')
`
}));

export const sourceCodecServiceCase = {
  name: "source diagnostics retain a service-provided filename subtype",
  source: String.raw`
class Filename(str):
    def __str__(self):
        raise AssertionError('filename conversion called an override')
filename = Filename(input())
for source in (b'\xef\xbb\xbf# coding: ascii\n1', b'# \xc3\xa9\xff\n1'):
    try:
        compile(source, filename, 'exec')
    except SyntaxError as error:
        assert error.filename is filename
        assert error.args[1][0] is None
        print(repr(error.args))
        print(repr(error.filename), type(error.filename).__name__)
    else:
        raise AssertionError('invalid source was accepted')
`
};

export const sourceCodecFilenameCase = {
  name: "source filename protocols preserve native subtype payloads",
  source: String.raw`
events = []
class Text(str):
    def __fspath__(self):
        raise AssertionError('str subtype path override')
    def __str__(self):
        raise AssertionError('str subtype conversion override')
class Data(bytes):
    def __fspath__(self):
        raise AssertionError('bytes subtype path override')
    def decode(self, *args):
        raise AssertionError('bytes subtype decode override')
class Path:
    def __init__(self, value):
        self.value = value
    def __fspath__(self):
        events.append('path')
        return self.value
for filename in (Text('native.py'), Data(b'native_\xff.py')):
    for path in (filename, Path(filename)):
        code = compile('1', path, 'eval')
        if isinstance(filename, str):
            assert code.co_filename is filename
        else:
            assert type(code.co_filename) is str
            assert code.co_filename == 'native_\udcff.py'
        try:
            compile(b'\xef\xbb\xbf# coding: ascii\n1', path, 'exec')
        except SyntaxError as error:
            if isinstance(filename, str):
                assert error.filename is filename
            else:
                assert type(error.filename) is str
                assert error.filename == 'native_\udcff.py'
            assert error.args[1][0] is None
            print(repr(error.filename), type(error.filename).__name__)
        else:
            raise AssertionError('conflicting BOM was accepted')
assert events == ['path', 'path', 'path', 'path']
failure = ValueError('filename failure')
class Broken:
    def __fspath__(self):
        raise failure
try:
    compile(b'\xef\xbb\xbf# coding: ascii\n1', Broken(), 'exec')
except ValueError as error:
    assert error is failure
else:
    raise AssertionError('filename callback did not fail')
`
};
