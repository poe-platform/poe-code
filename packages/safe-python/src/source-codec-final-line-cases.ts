/** Unchanged public programs shared by unit tests and external differential replay. */
export const sourceCodecFinalLineCases = ["exec", "eval"].map(mode => ({
  name: `${mode} final encoding-cookie lines`,
  source: String.raw`
filename = input().strip()
for prefix in (b'', b'\xef\xbb\xbf', b'# first\n', b'\xef\xbb\xbf# first\n'):
    for comment in (b'# coding: ascii', b'# coding: absent', b'# coding: latin-1\xe9', b'# coding: utf8\xff', b'# coding: utf-8\xff'):
        for ending in (b'', b'\n', b'\r', b'\r\n'):
            source = prefix + comment + ending
            try:
                compile(source, filename, '${mode}')
            except SyntaxError as error:
                print(repr(source), type(error).__name__, repr(error.args))
                print(repr((error.filename, error.lineno, error.offset, error.end_lineno, error.end_offset, error.text)))
            else:
                print(repr(source), 'ok')
`
}));

export const sourceCodecEmptyExpressionCase = {
  name: "empty expression source diagnostics",
  source: String.raw`
filename = input().strip()
for source in ('', '\n', '\r\n', '# comment', '# comment\n', '# first\n# second', '\n# \xe9\U0001f40d\r\n', ' ', '\t', '\f', '\f ', ' \f', ' \t', '\n  ', '# c\n  ', ' \n', ' \f\t', '\t\f\t', '# c\n\f'):
    for data in (source, source.encode('utf-8'), b'\xef\xbb\xbf' + source.encode('utf-8')):
        try:
            compile(data, filename, 'eval')
        except SyntaxError as error:
            print(type(data).__name__, repr(data), type(error).__name__, repr(error.args))
            print(repr((error.filename, error.lineno, error.offset, error.end_lineno, error.end_offset, error.text)))
        else:
            raise AssertionError('empty expression was accepted')
`
};
