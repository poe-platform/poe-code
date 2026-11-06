import assert from "node:assert/strict";
import test from "node:test";
import { CsvRows } from "./csv-rows.js";

const cases: [string, string, string[][]][] = [
  ['', ',', []], ['""', ',', [['']]], [',', ',', [['', '']]], ['\r', ',', [['\r']]],
  ['\n\r\n', ',', [[''], ['']]], ['""\n', ',', [['']]],
  ['"one\r\ntwo","a""b"\r\nlast,', ',', [['one\r\ntwo', 'a"b'], ['last', '']]],
  ['"é😀"<>"x"tail<>"unclosed', '<>', [['é😀', 'x"tail<>"unclosed']]],
  ['a\r\nb\r\n', '\r\n', [['a', 'b', '']]],
  ['a|||b||c', '||', [['a', '|b', 'c']]],
  ['a"b,c', ',', [['a"b', 'c']]]
];
for (const [source, separator, expected] of cases) test(`CSV preserves dialect across all boundaries: ${JSON.stringify(source)}`, () => {
  for (let width = 1; width <= source.length + 1; width++) {
    const parser = new CsvRows(separator), rows: string[][] = [];
    for (let at = 0; at < source.length; at += width) rows.push(...parser.push(source.slice(at, at + width)));
    rows.push(...parser.push('', true));
    assert.deepEqual(rows, expected, `chunk size ${width}`);
  }
});
test('empty import separators fail instead of looping', () => assert.throws(() => new CsvRows(''), /separator/));

for (const source of ['ok,1\n"x"oops,2\nend,3\n', 'ok,1\n"x']) {
  test(`CSV malformed quotes survive all boundaries: ${JSON.stringify(source)}`, () => {
    for (let width = 1; width <= source.length + 1; width++) {
      const diagnostics: string[] = [];
      const parser = new CsvRows(',', message => diagnostics.push(message));
      const rows: string[][] = [];
      for (let at = 0; at < source.length; at += width) rows.push(...parser.push(source.slice(at, at + width)));
      rows.push(...parser.push('', true));
      assert.deepEqual(rows, [['ok', '1'], [source.slice(6)]]);
      assert.deepEqual(diagnostics, source.includes('oops') ?
        ['2: unescaped " character\n', '2: unterminated "-quoted field\n'] :
        ['2: unterminated "-quoted field\n']);
    }
  });
}
