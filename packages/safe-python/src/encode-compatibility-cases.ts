export const encodeCases = [
  ...["ascii", "646", "ansi_x3.4_1968", "ansi_x3_4_1968", "ansi_x3.4_1986", "cp367", "csascii", "ibm367", "iso646_us", "iso_646.irv_1991", "iso_ir_6", "us", "us_ascii"].map(name => `assert 'abc\\0'.encode('${name}') == b'abc\\0'`),
  ...["latin-1", "latin_1", "latin1", "iso-8859-1", "8859", "cp819", "csisolatin1", "ibm819", "iso8859", "iso8859_1", "iso_8859_1", "iso_8859_1_1987", "iso_ir_100", "l1", "latin"].map(name => `assert 'éÿ\\0'.encode('${name}') == b'\\xe9\\xff\\0'`),
  ...["ascii", "latin-1"].flatMap(encoding => [
    `assert ''.encode('${encoding}', 'missing') == b''\nassert 'abc'.encode('${encoding}', 'missing') == b'abc'`,
    ...[["ignore", ""], ["replace", "??"], ["backslashreplace", "\\\\u0100\\\\U0001f40d"], ["xmlcharrefreplace", "&#256;&#128013;"], ["namereplace", "\\\\N{LATIN CAPITAL LETTER A WITH MACRON}\\\\N{SNAKE}"]].map(([mode, output]) => `assert 'Ā🐍'.encode('${encoding}', '${mode}') == b'${output}'`),
    ...["strict", "surrogatepass", "surrogateescape"].map(mode => `s='aĀ🐍z'\ntry:\n s.encode('${encoding}', '${mode}')\n assert False\nexcept UnicodeEncodeError as e:\n assert e.encoding == '${encoding}'\n assert e.object is s\n assert (e.start,e.end,e.reason)==(1,3,'ordinal not in range(${encoding === "ascii" ? 128 : 256})')`),
    `assert '\\udc80\\udcff'.encode('${encoding}', 'surrogateescape') == b'\\x80\\xff'`,
    `try:\n 'Ā'.encode('${encoding}', 'missing')\n assert False\nexcept LookupError as e:\n assert e.args == ("unknown error handler name 'missing'",)`,
  ]),
  `assert '\\x80Ƣ\\ud800'.encode('ascii','namereplace') == b'\\\\x80\\\\N{LATIN CAPITAL LETTER OI}\\\\ud800'`,
  `events=[]\nclass Text(str):\n def __str__(self):\n  events.append('str')\n  return 'wrong'\n def __len__(self):\n  events.append('len')\n  return 0\n def __getitem__(self,i):\n  events.append('get')\n  return 'wrong'\ns=Text('é')\nassert s.encode(Text('latin1'), Text('strict'))==b'\\xe9'\ntry:\n str.encode(s,Text('ascii'))\n assert False\nexcept UnicodeEncodeError as e:\n assert e.object is s\nassert events==[]`,
  ...["encoding", "errors"].flatMap(argument => [
    `try:\n ''.encode(${argument}='x\\0')\n assert False\nexcept ValueError as e:\n assert e.args==('embedded null character',)`,
    `name='x\\ud800'\ntry:\n ''.encode(${argument}=name)\n assert False\nexcept UnicodeEncodeError as e:\n assert e.object is name\n assert (e.encoding,e.start,e.end,e.reason)==('utf-8',1,2,'surrogates not allowed')`,
  ]),
  `try:\n ''.encode('missing')\n assert False\nexcept LookupError as e:\n assert e.args==('unknown encoding: missing',)`,
];

encodeCases.push(
  `events=[]\ndef arg(label,value):\n events.append(label)\n return value\nassert arg('receiver','é').encode(arg('encoding','ascii'),arg('errors','replace'))==b'?'\nassert events==['receiver','encoding','errors']`,
  ...["ascii", "latin-1"].map(encoding => `s='\\udc80\\ud800\\udc81'\ntry:\n s.encode('${encoding}','surrogateescape')\n assert False\nexcept UnicodeEncodeError as e:\n assert (e.start,e.end)==(1,3)\n assert e.object is s`),
  `assert '\\N{NULL}\\N{LATIN CAPITAL LETTER GHA}'.encode('ascii','namereplace')==b'\\0\\\\N{LATIN CAPITAL LETTER OI}'`,
  `assert '가一'.encode('ascii','namereplace')==b'\\\\N{HANGUL SYLLABLE GA}\\\\N{CJK UNIFIED IDEOGRAPH-4E00}'`,
);

encodeCases.push(
  ...["ascii_é_", "utf_é_", "utf_é_8", "latin_é_", "latin_é_1", "us.ascii", "iso.8859.1"].map(encoding => `assert 'abc'.encode('${encoding}') == b'abc'`),
  ...["utf.8", "latin.1", "asciéi"].map(encoding => `try:\n 'abc'.encode('${encoding}')\n assert False\nexcept LookupError as e:\n assert e.args == ('unknown encoding: ${encoding}',)`),
);
