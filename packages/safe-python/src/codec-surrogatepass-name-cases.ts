/** The error handler's native name recognizer is distinct from codec lookup.
 * Replay these programs unchanged against the pinned external reference. */
export const codecSurrogatepassNameCases = ["utf", "UTF", "Utf", "cp", "CP"].flatMap(prefix =>
  ["", "-", "_", " ", "--"].map(separator => {
    const names = ["8", "16", "32", "65001"].flatMap(width =>
      ["", "le", "LE", "be", "BE", "-le", "_be", "\0suffix"].map(suffix => prefix + separator + width + suffix));
    return {
      name: JSON.stringify([prefix, separator]),
      source: `import codecs
handler = codecs.lookup_error('surrogatepass')
for name in ${JSON.stringify(names)}:
    error = UnicodeEncodeError(name, '\\ud800', 0, 1, 'reason')
    try:
        print(repr(handler(error)))
    except UnicodeEncodeError as caught:
        print('error', caught is error)
`
    };
  })
);
