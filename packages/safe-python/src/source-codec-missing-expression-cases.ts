/** Identical guest programs for the public interpreter and pinned oracle. */
export const sourceCodecMissingExpressionCases = [
  {mode: "exec", text: "x ="},
  {mode: "exec", text: "x = "},
  {mode: "exec", text: "x = # café"},
  {mode: "exec", text: "if True:\n    x ="},
  {mode: "exec", text: "é = 1 +"},
  {mode: "exec", text: "x = 1 + # note"},
  {mode: "exec", text: "1 if True else"},
  {mode: "exec", text: "1 if True else # café"},
  {mode: "eval", text: "1 +"},
  {mode: "eval", text: "not"},
  {mode: "eval", text: "1 + # café"},
  {mode: "eval", text: "1 if True else"},
  {mode: "eval", text: "1 if True else # café"},
].flatMap(({mode, text}) => ["", "\n", "\r", "\r\n"].flatMap(ending => ["text", "utf8", "latin1"].map(kind => {
  const content = text + ending;
  const points = Array.from(content, character => character.codePointAt(0)!);
  const input = kind === "text" ? `''.join(chr(point) for point in ${JSON.stringify(points)})`
    : `bytes(${JSON.stringify(kind === "utf8" ? Array.from(new TextEncoder().encode(content)) : [...Array.from(new TextEncoder().encode("# coding: latin-1\n")), ...points])})`;
  return {
    name: `${mode}/${kind}: ${JSON.stringify(content)}`,
    source: `source = ${input}
try:
    compile(source, 'missing.py', '${mode}')
except SyntaxError as error:
    print(type(error).__name__, repr(error.args))
    print(error.msg, error.filename, error.lineno, error.offset, repr(error.text), error.end_lineno, error.end_offset)
else:
    raise AssertionError('missing expression accepted')
`
  };
})));
