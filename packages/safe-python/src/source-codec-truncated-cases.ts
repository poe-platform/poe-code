/** Public programs replayed unchanged against the pinned external oracle. */
export const sourceCodecTruncatedCases = ["utf8", "UTF8", "utf--8", "utf-8"].flatMap(encoding =>
  ["\\xc3", "\\xe2", "\\xe2\\x82", "\\xf0\\x90\\x80"].flatMap(tail =>
    (["exec", "eval"] as const).flatMap(mode =>
      ["", "\\n", "\\r", "\\r\\n"].map(ending => ({
        name: `${encoding} ${mode} ${tail} ending=${ending || "none"}`,
        source: `
data = b"# coding: ${encoding}\\nx='${tail}${ending}"
try:
    compile(data, 'truncated.py', '${mode}')
except SyntaxError as error:
    print(type(error).__name__, error.args)
    print(error.filename, error.lineno, error.offset, error.end_lineno, error.end_offset, repr(error.text))
    print(error.__cause__, error.__context__, getattr(error, '__notes__', None))
else:
    raise AssertionError('truncated source must fail')
`
      })))));
