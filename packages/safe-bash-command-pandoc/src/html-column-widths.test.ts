import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert} from "./index.js";

for (const retained of [false, true]) it.each([
  ['<col width="20%"><col width="80%">', [0.2, 0.8]],
  ['<col style="width: 20%"><col style="width:80%">', [0.2, 0.8]],
  ['<col width="30%" style="color:red; width: 12.5%;"><col>', [0.125, null]],
  ['<col width="invalid"><col width="200px">', [null, null]],
  ['', [null, null]],
  ['<col width="20%">', [0.2, null]]
])(`preserves HTML column widths through JSON and HTML5 (retained=${retained}): %s`, async (columns, widths) => {
  const context = retained ? {workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384}} : {};
  const input = `<table><colgroup>${columns}</colgroup><tr><td>Left</td><td>Right</td></tr></table>`;
  const expected = widths.map(width => [{t: "AlignDefault"}, width === null ? {t: "ColWidthDefault"} : {t: "ColWidth", c: width}]);
  const json = await convert([{bytes: new TextEncoder().encode(input)}], {from: "html", to: "json"}, context);
  if (json.kind !== "text") throw new Error("Expected JSON text");
  expect(JSON.parse(json.text).blocks[0].c[2]).toEqual(expected);
  const html = await convert([{bytes: new TextEncoder().encode(input)}], {from: "html", to: "html5"}, context);
  if (html.kind !== "text") throw new Error("Expected HTML text");
  expect(html.diagnostics).toEqual([]);
  for (const width of widths) if (width !== null) expect(html.text).toContain(`width:${width * 100}%`);
  const roundTrip = await convert([{bytes: new TextEncoder().encode(html.text)}], {from: "html", to: "json"}, context);
  if (roundTrip.kind !== "text") throw new Error("Expected JSON text");
  expect(JSON.parse(roundTrip.text).blocks[0].c[2]).toEqual(expected);
});
