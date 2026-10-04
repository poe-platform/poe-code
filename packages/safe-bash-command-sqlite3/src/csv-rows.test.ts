import assert from "node:assert/strict";
import test from "node:test";
import { CsvRows } from "./csv-rows.js";

const cases: [string, string, string[][]][] = [
  ['', ',', []], ['""', ',', []], [',', ',', [['', '']]], ['\r', ',', [['\r']]],
  ['\n\r\n', ',', [[''], ['']]], ['""\n', ',', [['']]],
  ['"one\r\ntwo","a""b"\r\nlast,', ',', [['one\r\ntwo', 'a"b'], ['last', '']]],
  ['"é😀"<>"x"tail<>"unclosed', '<>', [['é😀', 'xtail', 'unclosed']]],
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
