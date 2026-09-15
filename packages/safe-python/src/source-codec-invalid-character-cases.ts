/** Sources cross the real bytes/str compilation boundary in both interpreters. */
export const sourceCodecInvalidCharacterCases = [
  "\ufeff", "\u00a0", "\u200b", "😀", "²", "\u0301", "\u0378", "\u{1fae9}",
  "\u0001", "\u0007", "\u0008", "\u000b", "\u000e", "\u001f", "\u007f"
].flatMap(character => ["", "name", "𝒙"].map(prefix => ({
  name: `${character.codePointAt(0)!.toString(16)} after ${prefix || "start"}`,
  source: `
text = '# coding: utf-8\\n' + ${JSON.stringify(prefix + character + "suffix")} + '\\n'
for data in (text, text.encode('utf-8'), b'\\xef\\xbb\\xbf' + text.encode('utf-8')):
    for mode in ('exec', 'eval'):
        try:
            compile(data, 'invalid-source.py', mode)
            print('ok')
        except SyntaxError as error:
            print(type(error).__name__, repr(error.args))
            print(repr((error.msg, error.filename, error.lineno, error.offset, error.text, error.end_lineno, error.end_offset)))
`
})));
