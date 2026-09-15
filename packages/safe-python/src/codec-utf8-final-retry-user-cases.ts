/** Programs replayed unchanged against the pinned external CPython oracle. */
export const codecUtf8FinalRetryUserCases = ["utf-8", "utf-8-sig"].flatMap(encoding =>
  ["strict", "ignore", "replace", "backslashreplace", "surrogateescape", "surrogatepass"].map(policy => ({
    name: `${encoding}: finalization, restore and retry with ${policy}`,
    source: `import codecs
factory = codecs.getincrementaldecoder('${encoding}')
decoder = factory('${policy}')
def step(data, final):
    try:
        result = decoder.decode(data, final)
    except UnicodeDecodeError as error:
        print('error', type(error).__name__, error.encoding, error.object,
              error.start, error.end, error.reason, error.args)
    else:
        print('text', type(result).__name__, [ord(c) for c in result])
    print('state', decoder.getstate(), decoder.errors)
for prefix in [b'\\xef', b'\\xef\\xbb', b'\\xe2', b'\\xed\\xa0', b'\\xf0\\x9f\\x90']:
    print('reset', decoder.reset())
    decoder.errors = '${policy}'
    step(prefix, False)
    saved = decoder.getstate()
    step(b'', True)
    step(b'', True)
    print('restore', decoder.setstate(saved))
    decoder.errors = 'replace'
    step(b'Z', True)
    print('restore', decoder.setstate(saved))
    decoder.errors = 'surrogatepass'
    step(b'\\x80', True)
    decoder.errors = 'ignore'
    step(b'', True)
    step(b'\\xef\\xbb\\xbfA', True)
    print('saved', saved)
print('reset', decoder.reset())
decoder.errors = '${policy}'
step(b'\\xef', True)
step(b'\\xbb', True)
step(b'\\xbf', True)
step(b'\\xf0', False)
step(b'\\x9f', False)
step(b'\\x90', False)
step(b'\\x8d', True)
step(b'\\xef\\xbb\\xbf', True)
`,
  })),
);
