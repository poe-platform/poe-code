/** Unchanged guest programs for the pinned external differential oracle. */
export const sourceCodecTrailingTokenCases = [
  "x = A", "x = ÿ", "x; y", "1 2", "1 : 2", "x += 1", "x -> y", "x = # comment",
].flatMap(text => ["", "\n", "\r\n"].flatMap(ending => ["text", "utf8", "latin1"].map(kind => {
  const content = text + ending;
  const points = Array.from(content, character => character.codePointAt(0)!);
  const input = kind === "text" ? `''.join(chr(point) for point in ${JSON.stringify(points)})`
    : `bytes(${JSON.stringify(kind === "utf8" ? Array.from(new TextEncoder().encode(content)) : [...Array.from(new TextEncoder().encode("# coding: latin-1\n")), ...points])})`;
  return {
    name: `${kind}: ${JSON.stringify(content)}`,
    source: `source = ${input}
try:
    compile(source, 'trailing.py', 'eval')
except SyntaxError as error:
    print(type(error).__name__, repr(error.args))
    print(error.msg, error.filename, error.lineno, error.offset, repr(error.text), error.end_lineno, error.end_offset)
else:
    raise AssertionError('invalid expression was accepted')
`
  };
})));
