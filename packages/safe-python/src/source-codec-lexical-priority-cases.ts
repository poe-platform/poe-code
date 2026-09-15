/** Identical public programs for the interpreter and the pinned external oracle. */
export const sourceCodecLexicalPriorityCases = ["exec", "eval"].flatMap(mode => [
  "x = \ufeff", "x =\n\ufeff", "1 +\n\ufeff", "1 if True else\n\ufeff",
  "x = â\u0082", "x = í\u00a0\u0080", "x = ï»¿",
  "x = (", "x =\n(", "x = f\"{", "x = f\"{\ufeff",
  "x = 1 # \ufeff", "x = '\ufeff'",
  String.raw`x = "\x"`, String.raw`x = b"\x"`, String.raw`x = "\N{no}"`,
  String.raw`x = f"\x"`, String.raw`x = t"\x"`, 'x = b"é"'
].flatMap(text => ["", "\n", "\r\n"].flatMap(ending => ["text", "utf8", "latin1"].filter(kind => kind !== "latin1" || Array.from(text).every(point => point.codePointAt(0)! <= 255)).map(kind => {
  const content = text + ending;
  const points = Array.from(content, point => point.codePointAt(0)!);
  const input = kind === "text" ? `''.join(chr(point) for point in ${JSON.stringify(points)})`
    : `bytes(${JSON.stringify(kind === "utf8" ? Array.from(new TextEncoder().encode(content)) : [...Array.from(new TextEncoder().encode("# coding: latin-1\n")), ...points])})`;
  return {name: `${mode}/${kind}: ${JSON.stringify(content)}`, source: `source = ${input}
try:
    compile(source, 'priority.py', '${mode}')
except SyntaxError as error:
    print(type(error).__name__, repr(error.args))
    print(error.msg, error.filename, error.lineno, error.offset, repr(error.text), error.end_lineno, error.end_offset)
else:
    print('ok')
`};
}))));
