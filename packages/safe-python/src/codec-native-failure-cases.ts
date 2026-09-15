const spellings:readonly [string,boolean][]=[
  ["utf8",false],["UTF--8",false],["---utf8---",false],["utf16",false],["utf_32",false],
  ["ascii",false],["us-ascii",false],["latin1",false],["iso-8859-1",false],["iso8859-1",false],
  ["u8",true],["utf8.ucs2",true],["us.ascii",true],["latin",true],["u16",true],["u32",true],
  ["utf_16_le",true],["utf_32_be",true],["UTF 8 SIG",true],["cp1252",true]
];

export const codecNativeFailureCases=[
  ...spellings.flatMap(([encoding,noted])=>[
    "text.encode(encoding)","str.encode(text, encoding)","bytes(text, encoding)","bytes.__new__(bytes, text, encoding)"
  ].map(operation=>({name:`${encoding}: ${operation}`,source:`
class Text(str):
    pass
text = Text('\\ud800')
encoding = ${JSON.stringify(encoding)}
try:
    ${operation}
except UnicodeEncodeError as error:
    assert error.object is text
    assert getattr(error, '__notes__', None) == ${noted?`["encoding with '${encoding}' codec failed"]`:'None'}
else:
    assert False
`}))),
  ...[
    ["utf8",false],["u8",true],["utf_16",false],["utf_16_le",true],
    ["utf_32",false],["u32",true],["utf-8-sig",true],["ascii",false],
    ["us.ascii",true],["cp1252",true],["punycode",true],["unicode_escape",true],["raw_unicode_escape",true]
  ].flatMap(([encoding,noted])=>["data.decode(encoding)","str(data, encoding)"].map(operation=>({
    name:`${encoding}: ${operation}`,source:`
encoding = ${JSON.stringify(encoding)}
data = b'\\x81' if encoding == 'cp1252' else br'\\u' if encoding in ('unicode_escape', 'raw_unicode_escape') else b'\\xff'
try:
    ${operation}
except UnicodeDecodeError as error:
    assert getattr(error, '__notes__', None) == ${noted?`["decoding with '${encoding}' codec failed"]`:'None'}
else:
    assert False
`}))),
  ...["encode","decode"].flatMap(operation=>["utf-8","u8","utf-8-sig","utf_16_le"].map(encoding=>({
    name:`${encoding}: ${operation} guest failure identity and notes`,source:`
import _codecs
class Failure(BaseException):
    def add_note(self, note):
        raise AssertionError('override must not run')
failure = Failure('guest failure')
notes = ['existing']
failure.__notes__ = notes
def handler(error):
    raise failure
_codecs.register_error('native_failure', handler)
try:
    ${operation==="encode"?`'\\ud800'.encode('${encoding}', 'native_failure')`:`b'\\xff'.decode('${encoding}', 'native_failure')`}
except Failure as caught:
    assert caught is failure
    assert caught.__notes__ is notes
    assert notes == ${encoding==="utf-8"?"['existing']":`['existing', "${operation==="encode"?"encoding":"decoding"} with '${encoding}' codec failed"]`}
else:
    assert False
`}))),
  ...["encode","decode"].map(operation=>({
    name:`${operation} invalid notes retain original context`,source:`
import _codecs
failure = ValueError('original')
failure.__notes__ = 42
def handler(error):
    raise failure
_codecs.register_error('bad_native_notes', handler)
try:
    ${operation==="encode"?"'\\ud800'.encode('utf-8-sig', 'bad_native_notes')":"b'\\xff'.decode('utf-8-sig', 'bad_native_notes')"}
except TypeError as error:
    assert error.__context__ is failure
    assert error.args == ('Cannot add note: __notes__ is not a list',)
    assert failure.__notes__ == 42
else:
    assert False
`}))
];
