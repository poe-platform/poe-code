// Adapted from Mozilla PDF.js test/unit/cff_parser_spec.js (Apache-2.0).
// Byte tables and expectations are retained; assertions use Vitest.
import { expect, it } from "vitest";
import { CFFParser, CFFStrings, Stream } from "../vendor/pdfjs-fonts.mjs";

it("parses predefined CFF charsets", () => {
  const parser = new CFFParser(new Stream(new Uint8Array()), {}, false);
  expect(parser.parseCharsets(0, 0, null, true).predefined).toBe(true);
});

it.each([
  {format: 0, bytes: [0, 0, 0, 0, 0, 2], names: [".notdef", "exclam"], cids: [0, 2]},
  {format: 1, bytes: [0, 0, 0, 1, 0, 8, 1], names: [".notdef", "quoteright", "parenleft"], cids: [0, 8, 9]},
  {format: 2, bytes: [0, 0, 0, 2, 0, 8, 0, 1], names: [".notdef", "quoteright", "parenleft"], cids: [0, 8, 9]},
])("parses CFF charset format $format as names and CIDs", ({bytes, names, cids}) => {
  const parser = new CFFParser(new Stream(Uint8Array.from(bytes)), {}, false);
  expect(parser.parseCharsets(3, 2, new CFFStrings(), false).charset).toEqual(names);
  expect(parser.parseCharsets(3, 2, new CFFStrings(), true).charset).toEqual(cids);
});

it.each([
  {format: 0, bytes: [0, 0, 0, 1, 8], encoding: {8: 1}},
  {format: 1, bytes: [0, 0, 1, 1, 7, 1], encoding: {7: 1, 8: 2}},
])("parses CFF encoding format $format", ({bytes, encoding}) => {
  const parser = new CFFParser(new Stream(Uint8Array.from(bytes)), {}, false);
  expect(parser.parseEncoding(2, {}, new CFFStrings(), null).encoding).toEqual(encoding);
});

it.each([
  {name: "format 0", bytes: [0, 0, 1], count: 2, format: 0, fds: [0, 1]},
  {name: "format 3", bytes: [3, 0, 2, 0, 0, 9, 0, 2, 10, 0, 4], count: 4, format: 3, fds: [9, 9, 10, 10]},
  {name: "invalid first GID (bug 1146106)", bytes: [3, 0, 2, 0, 1, 9, 0, 2, 10, 0, 4], count: 4, format: 3, fds: [9, 9, 10, 10]},
])("parses CFF FDSelect $name", ({bytes, count, format, fds}) => {
  const parser = new CFFParser(new Stream(Uint8Array.from(bytes)), {}, false);
  expect(parser.parseFDSelect(0, count)).toMatchObject({format, fdSelect: fds});
});
