const argumentsByName = [
  ["ordinary", "'utf8', 'strict'"],
  ["unknown", "'not_a_codec', 'not_a_handler'"],
  ["encoding type", "None, 'strict'"],
  ["errors type", "'utf8', None"],
  ["encoding null", "'utf8\\x00', 'strict'"],
  ["errors null", "'utf8', 'strict\\x00'"],
  ["encoding surrogate", "'\\x00\\ud800', 'strict'"],
  ["errors surrogate", "'utf8', '\\x00\\ud800'"],
] as const;

export const codecTextInputPrecedenceCases = argumentsByName.flatMap(([name, args]) =>
  ["str(text, ARGS)", "str.__new__(str, text, ARGS)", "str(object=text, encoding=ENCODING, errors=ERRORS)"].map((expression, index) => {
    const [encoding, errors] = args.split(", ");
    const call = expression.replace("ARGS", args).replace("ENCODING", encoding).replace("ERRORS", errors);
    return {name: `${name}: ${index}`, source: `
events = []
class Text(str):
    def __str__(self):
        events.append('str')
        raise AssertionError('unexpected str')
    def __bytes__(self):
        events.append('bytes')
        raise AssertionError('unexpected bytes')
    def __buffer__(self, flags):
        events.append('buffer')
        raise AssertionError('unexpected buffer')
text = Text('content')
try:
    ${call}
except Exception as error:
    print(type(error).__name__, str(error))
    if isinstance(error, UnicodeEncodeError):
        print(repr(error.object), error.start, error.end, error.reason)
else:
    raise AssertionError('text decoding succeeded')
print(events)
`};
  })
);
