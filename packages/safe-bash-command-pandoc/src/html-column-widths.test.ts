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
  for (const width of widths) if (width !== null) expect(html.text).toContain(`<col style="width: ${Math.trunc(width * 100)}%" />`);
  const roundTrip = await convert([{bytes: new TextEncoder().encode(html.text)}], {from: "html", to: "json"}, context);
  if (roundTrip.kind !== "text") throw new Error("Expected JSON text");
  expect(JSON.parse(roundTrip.text).blocks[0].c[2]).toEqual(widths.includes(0.125) ? [[{t: "AlignDefault"}, {t: "ColWidth", c: 0.12}], expected[1]] : expected);
});

for (const retained of [false, true]) it.each([
  ["One", "", [null, null]],
  ["<p>One</p>", "", [null, null]],
  ["<p>One</p><p>Two</p>", "", [0.5, 0.5]],
  ["<p>One</p><p>Two</p>", "<colgroup><col><col></colgroup>", [null, null]],
  ["<p>One</p><p>Two</p>", '<colgroup><col width="20%"><col width="80%"></colgroup>', [0.2, 0.8]],
  ["<ul><li>One</li></ul>", "", [0.5, 0.5]]
])(`infers widths for complex HTML cells only without column specs (retained=${retained}): %s %s`, async (cell, columns, widths) => {
  const context = retained ? {workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384}} : {};
  const input = `<table>${columns}<tr><td>${cell}</td><td>Right</td></tr></table>`;
  const expected = widths.map(width => [{t: "AlignDefault"}, width === null ? {t: "ColWidthDefault"} : {t: "ColWidth", c: width}]);
  const json = await convert([{bytes: new TextEncoder().encode(input)}], {from: "html", to: "json"}, context);
  if (json.kind !== "text") throw new Error("Expected JSON text");
  expect(json.diagnostics).toEqual([]);
  expect(JSON.parse(json.text).blocks[0].c[2]).toEqual(expected);
  const html = await convert([{bytes: new TextEncoder().encode(input)}], {from: "html", to: "html5"}, context);
  if (html.kind !== "text") throw new Error("Expected HTML text");
  expect(html.diagnostics).toEqual([]);
  if (cell.includes("<p>Two</p>")) expect(html.text).toContain("<p>One</p>\n<p>Two</p>");
  for (const width of widths) if (width !== null) expect(html.text).toContain(`<col style="width: ${Math.trunc(width * 100)}%" />`);
  const roundTrip = await convert([{bytes: new TextEncoder().encode(html.text)}], {from: "html", to: "json"}, context);
  if (roundTrip.kind !== "text") throw new Error("Expected JSON text");
  // When all columns have default widths the writer omits the colgroup;
  // reading the complex cell then infers equal widths.
  expect(JSON.parse(roundTrip.text).blocks[0].c[2]).toEqual(columns === "<colgroup><col><col></colgroup>"
    ? widths.map(() => [{t: "AlignDefault"}, {t: "ColWidth", c: 0.5}]) : expected);
});
