/** Unchanged guest programs also executed by the pinned external oracle. */
export const codecHandlerSpanCases = ["strict", "ignore", "replace", "backslashreplace", "xmlcharrefreplace", "namereplace", "surrogatepass", "surrogateescape"].map(handler => ({
  handler,
  source: String.raw`
import _codecs
handler = _codecs.lookup_error('${handler}')
for mode in ('encode', 'decode', 'translate'):
    for data in ('', 'A', '\ud800', '\udc80', 'A\ud800B', '\U0001f40d'):
        for start, end in ((-5,-2), (0,0), (0,9), (9,0), (2,1), (1,2)):
            if mode == 'encode':
                error = UnicodeEncodeError('utf-8', data, start, end, 'reason')
            elif mode == 'decode':
                error = UnicodeDecodeError('utf-8', data.encode('utf-8','surrogatepass'), start, end, 'reason')
            else:
                error = UnicodeTranslateError(data, start, end, 'reason')
            original_args = error.args
            try:
                result = handler(error)
                print(mode, repr(data), start, end, type(result).__name__, type(result[0]).__name__, type(result[1]).__name__, repr(result))
            except BaseException as caught:
                print(mode, repr(data), start, end, type(caught).__name__, repr(caught.args), caught is error)
            assert error.args is original_args
            assert (error.start, error.end) == (start, end)
`
}));
