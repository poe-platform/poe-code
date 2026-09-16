import { Volume } from "memfs";
import { deflateSync } from "node:zlib";
import { joinBytes, pngChunk, rasterPng, rasterJpeg, rasterBmp, rasterGif, rasterTiff } from "../tests/fixtures/raster.js";
import { expect, it } from "vitest";
import { Document, Inches, Length, WD_TABLE_ALIGNMENT, WD_TABLE_DIRECTION, WD_ROW_HEIGHT_RULE, WD_CELL_VERTICAL_ALIGNMENT, WD_UNDERLINE, WD_COLOR_INDEX, WD_ALIGN_PARAGRAPH, Pt, RGBColor, MSO_COLOR_TYPE, MSO_THEME_COLOR_INDEX, WD_LINE_SPACING, WD_SECTION_START, WD_ORIENT, _Header, _Footer, Comments, Comment, Hyperlink, RenderedPageBreak, Image, Run, DocumentView, Sections, Section, ParagraphFormat, Font, ColorFormat, TabStops, WD_STYLE_TYPE, WD_BREAK, Paragraph, Table, Styles, InlineShapes, WD_INLINE_SHAPE, Drawing, CoreProperties, Settings, type ParagraphStyle, type CharacterStyle, type TableStyle } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";

it("workflow-352 observes cell grid_span read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:gridSpan w:val=\"1\"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect(target.grid_span).toEqual(1);
});

it("workflow-353 observes cell grid_span read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:gridSpan w:val=\"2\"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect(target.grid_span).toEqual(2);
});

it("workflow-354 observes cell grid_span read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:gridSpan w:val=\"4\"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect(target.grid_span).toEqual(4);
});

it("workflow-355 observes cell vertical_alignment read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect(target.vertical_alignment).toEqual(null);
});

it("workflow-356 observes cell vertical_alignment read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:vAlign w:val=\"bottom\"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect(target.vertical_alignment).toEqual(WD_CELL_VERTICAL_ALIGNMENT.BOTTOM);
});

it("workflow-357 observes cell vertical_alignment read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:vAlign w:val=\"center\"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect(target.vertical_alignment).toEqual(WD_CELL_VERTICAL_ALIGNMENT.CENTER);
});

it("workflow-358 observes cell vertical_alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
target.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.BOTTOM;
expect(target.vertical_alignment).toEqual(WD_CELL_VERTICAL_ALIGNMENT.BOTTOM);
});

it("workflow-359 observes cell vertical_alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:vAlign w:val=\"bottom\"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
target.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER;
expect(target.vertical_alignment).toEqual(WD_CELL_VERTICAL_ALIGNMENT.CENTER);
});

it("workflow-360 observes cell vertical_alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:vAlign w:val=\"center\"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
target.vertical_alignment = null;
expect(target.vertical_alignment).toEqual(null);
});

it("workflow-361 observes cell vertical_alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
target.vertical_alignment = null;
expect(target.vertical_alignment).toEqual(null);
});

it("workflow-362 observes cell width read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect((target.width as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-363 observes cell width read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
expect((target.width as Length | null)?.emu ?? null).toEqual(Inches(1).emu);
});

it("workflow-364 observes cell width transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
target.width = Inches(1);
expect((target.width as Length | null)?.emu ?? null).toEqual(Inches(1).emu);
});

it("workflow-365 observes cell width transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.cell(0, 0);
target.width = Inches(1);
expect((target.width as Length | null)?.emu ?? null).toEqual(Inches(1).emu);
});

it("workflow-367 observes column width read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.columns.at(0);
expect((target.width as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-368 observes column width read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.columns.at(0);
expect((target.width as Length | null)?.emu ?? null).toEqual(914400);
});

it("workflow-369 observes column width transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.columns.at(0);
target.width = null;
expect((target.width as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-370 observes column width transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.columns.at(0);
target.width = Length(914400);
expect((target.width as Length | null)?.emu ?? null).toEqual(914400);
});

it("workflow-371 observes column width transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.columns.at(0);
target.width = null;
expect((target.width as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-372 observes column width transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.columns.at(0);
target.width = Length(914400);
expect((target.width as Length | null)?.emu ?? null).toEqual(914400);
});

it("workflow-373 observes column width transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.columns.at(0);
target.width = Length(424497);
expect((target.width as Length | null)?.emu ?? null).toEqual(424180);
});

it("workflow-392 observes table alignment read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.alignment).toEqual(null);
});

it("workflow-393 observes table alignment read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:jc w:val=\"left\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.alignment).toEqual(WD_TABLE_ALIGNMENT.LEFT);
});

it("workflow-394 observes table alignment read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:jc w:val=\"right\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.alignment).toEqual(WD_TABLE_ALIGNMENT.RIGHT);
});

it("workflow-395 observes table alignment read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:jc w:val=\"center\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.alignment).toEqual(WD_TABLE_ALIGNMENT.CENTER);
});

it("workflow-396 observes table alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.alignment = WD_TABLE_ALIGNMENT.LEFT;
expect(target.alignment).toEqual(WD_TABLE_ALIGNMENT.LEFT);
});

it("workflow-397 observes table alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:jc w:val=\"left\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.alignment = WD_TABLE_ALIGNMENT.RIGHT;
expect(target.alignment).toEqual(WD_TABLE_ALIGNMENT.RIGHT);
});

it("workflow-398 observes table alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:jc w:val=\"right\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.alignment = WD_TABLE_ALIGNMENT.CENTER;
expect(target.alignment).toEqual(WD_TABLE_ALIGNMENT.CENTER);
});

it("workflow-399 observes table alignment transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:jc w:val=\"center\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.alignment = null;
expect(target.alignment).toEqual(null);
});

it("workflow-400 observes table autofit read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.autofit).toEqual(true);
});

it("workflow-401 observes table autofit read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:tblLayout w:type=\"autofit\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.autofit).toEqual(true);
});

it("workflow-402 observes table autofit read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:tblLayout w:type=\"fixed\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.autofit).toEqual(false);
});

it("workflow-403 observes table autofit transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.autofit = true;
expect(target.autofit).toEqual(true);
});

it("workflow-404 observes table autofit transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.autofit = false;
expect(target.autofit).toEqual(false);
});

it("workflow-405 observes table autofit transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:tblLayout w:type=\"fixed\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.autofit = true;
expect(target.autofit).toEqual(true);
});

it("workflow-406 observes table autofit transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:tblLayout w:type=\"autofit\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.autofit = true;
expect(target.autofit).toEqual(true);
});

it("workflow-407 observes table autofit transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:tblLayout w:type=\"fixed\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.autofit = false;
expect(target.autofit).toEqual(false);
});

it("workflow-408 observes table autofit transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:tblLayout w:type=\"autofit\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.autofit = false;
expect(target.autofit).toEqual(false);
});

it("workflow-409 observes table table_direction read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.table_direction).toEqual(null);
});

it("workflow-410 observes table table_direction read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:bidiVisual w:val=\"1\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.table_direction).toEqual(WD_TABLE_DIRECTION.RTL);
});

it("workflow-411 observes table table_direction read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:bidiVisual w:val=\"0\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
expect(target.table_direction).toEqual(WD_TABLE_DIRECTION.LTR);
});

it("workflow-412 observes table table_direction transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.table_direction = WD_TABLE_DIRECTION.RTL;
expect(target.table_direction).toEqual(WD_TABLE_DIRECTION.RTL);
});

it("workflow-413 observes table table_direction transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:bidiVisual w:val=\"1\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.table_direction = WD_TABLE_DIRECTION.LTR;
expect(target.table_direction).toEqual(WD_TABLE_DIRECTION.LTR);
});

it("workflow-414 observes table table_direction transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr><w:bidiVisual w:val=\"0\"/></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table;
target.table_direction = null;
expect(target.table_direction).toEqual(null);
});

it("workflow-415 observes row grid_cols_after read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:gridAfter w:val=\"0\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.grid_cols_after).toEqual(0);
});

it("workflow-416 observes row grid_cols_after read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:gridAfter w:val=\"1\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.grid_cols_after).toEqual(1);
});

it("workflow-417 observes row grid_cols_after read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:gridAfter w:val=\"2\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.grid_cols_after).toEqual(2);
});

it("workflow-418 observes row grid_cols_before read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val=\"0\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.grid_cols_before).toEqual(0);
});

it("workflow-419 observes row grid_cols_before read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val=\"1\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.grid_cols_before).toEqual(1);
});

it("workflow-420 observes row grid_cols_before read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:gridBefore w:val=\"3\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.grid_cols_before).toEqual(3);
});

it("workflow-421 observes row height_rule read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.height_rule).toEqual(null);
});

it("workflow-422 observes row height_rule read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:hRule=\"auto\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.height_rule).toEqual(WD_ROW_HEIGHT_RULE.AUTO);
});

it("workflow-423 observes row height_rule read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:hRule=\"atLeast\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect(target.height_rule).toEqual(WD_ROW_HEIGHT_RULE.AT_LEAST);
});

it("workflow-424 observes row height_rule transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height_rule = WD_ROW_HEIGHT_RULE.AUTO;
expect(target.height_rule).toEqual(WD_ROW_HEIGHT_RULE.AUTO);
});

it("workflow-425 observes row height_rule transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:hRule=\"auto\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST;
expect(target.height_rule).toEqual(WD_ROW_HEIGHT_RULE.AT_LEAST);
});

it("workflow-426 observes row height_rule transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:hRule=\"atLeast\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height_rule = null;
expect(target.height_rule).toEqual(null);
});

it("workflow-427 observes row height_rule transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height_rule = null;
expect(target.height_rule).toEqual(null);
});

it("workflow-428 observes row height read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect((target.height as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-429 observes row height read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"2880\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect((target.height as Length | null)?.emu ?? null).toEqual(1828800);
});

it("workflow-430 observes row height read", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"4320\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
expect((target.height as Length | null)?.emu ?? null).toEqual(2743200);
});

it("workflow-431 observes row height transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height = Length(1828800);
expect((target.height as Length | null)?.emu ?? null).toEqual(1828800);
});

it("workflow-432 observes row height transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"2880\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height = Length(2743200);
expect((target.height as Length | null)?.emu ?? null).toEqual(2743200);
});

it("workflow-433 observes row height transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val=\"4320\"/></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height = null;
expect((target.height as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-434 observes row height transition", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblPr></w:tblPr><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:trPr></w:trPr><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc><w:tc><w:tcPr></w:tcPr><w:p/></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 const target = table.rows.at(0);
target.height = null;
expect((target.height as Length | null)?.emu ?? null).toEqual(null);
});
it("workflow-163 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.underline).toEqual(null);
});

it("workflow-164 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"none\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.underline).toEqual(false);
});

it("workflow-165 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.underline).toEqual(true);
});

it("workflow-166 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"double\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.underline).toEqual(WD_UNDERLINE.DOUBLE);
});

it("workflow-167 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = true;
expect(target.underline).toEqual(true);
});

it("workflow-168 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = false;
expect(target.underline).toEqual(false);
});

it("workflow-169 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = null;
expect(target.underline).toEqual(null);
});

it("workflow-170 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = WD_UNDERLINE.SINGLE;
expect(target.underline).toEqual(true);
});

it("workflow-171 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = WD_UNDERLINE.DOUBLE;
expect(target.underline).toEqual(WD_UNDERLINE.DOUBLE);
});

it("workflow-172 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = null;
expect(target.underline).toEqual(null);
});

it("workflow-173 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = true;
expect(target.underline).toEqual(true);
});

it("workflow-174 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = false;
expect(target.underline).toEqual(false);
});

it("workflow-175 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = WD_UNDERLINE.SINGLE;
expect(target.underline).toEqual(true);
});

it("workflow-176 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 target.underline = WD_UNDERLINE.DOUBLE;
expect(target.underline).toEqual(WD_UNDERLINE.DOUBLE);
});

it("workflow-470 observes font highlight_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.highlight_color).toEqual(null);
});

it("workflow-471 observes font highlight_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:highlight w:val=\"yellow\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.highlight_color).toEqual(WD_COLOR_INDEX.YELLOW);
});

it("workflow-472 observes font highlight_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:highlight w:val=\"green\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.highlight_color).toEqual(WD_COLOR_INDEX.BRIGHT_GREEN);
});

it("workflow-473 observes font highlight_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.highlight_color = WD_COLOR_INDEX.YELLOW;
expect(target.highlight_color).toEqual(WD_COLOR_INDEX.YELLOW);
});

it("workflow-474 observes font highlight_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:highlight w:val=\"yellow\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.highlight_color = null;
expect(target.highlight_color).toEqual(null);
});

it("workflow-475 observes font highlight_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:highlight w:val=\"green\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.highlight_color = WD_COLOR_INDEX.BRIGHT_GREEN;
expect(target.highlight_color).toEqual(WD_COLOR_INDEX.BRIGHT_GREEN);
});

it("workflow-476 observes font name variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.name).toBe(null);
});

it("workflow-477 observes font name variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:rFonts w:ascii=\"Avenir Black\" w:hAnsi=\"Avenir Black\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.name).toBe("Avenir Black");
});

it("workflow-478 observes font name variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.name = "Avenir Black";
expect(target.name).toBe("Avenir Black");
});

it("workflow-479 observes font name variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:rFonts w:ascii=\"Avenir Black\" w:hAnsi=\"Avenir Black\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.name = "Calibri";
expect(target.name).toBe("Calibri");
});

it("workflow-480 observes font name variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:rFonts w:ascii=\"Avenir Black\" w:hAnsi=\"Avenir Black\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.name = null;
expect(target.name).toBe(null);
});

it("workflow-481 observes font size variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect((target.size as Length | null)?.emu ?? null).toBe(null);
});

it("workflow-482 observes font size variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:sz w:val=\"28\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect((target.size as Length | null)?.emu ?? null).toBe(177800);
});

it("workflow-483 observes font size variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.size = Length(177800);
expect((target.size as Length | null)?.emu ?? null).toBe(177800);
});

it("workflow-484 observes font size variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:sz w:val=\"28\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.size = Length(228600);
expect((target.size as Length | null)?.emu ?? null).toBe(228600);
});

it("workflow-485 observes font size variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:sz w:val=\"36\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.size = null;
expect((target.size as Length | null)?.emu ?? null).toBe(null);
});

it("workflow-487 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.underline).toEqual(null);
});

it("workflow-488 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"none\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.underline).toEqual(false);
});

it("workflow-489 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.underline).toEqual(true);
});

it("workflow-490 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"double\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect(target.underline).toEqual(WD_UNDERLINE.DOUBLE);
});

it("workflow-491 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = true;
expect(target.underline).toEqual(true);
});

it("workflow-492 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = false;
expect(target.underline).toEqual(false);
});

it("workflow-493 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = null;
expect(target.underline).toEqual(null);
});

it("workflow-494 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = WD_UNDERLINE.SINGLE;
expect(target.underline).toEqual(true);
});

it("workflow-495 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = WD_UNDERLINE.DOUBLE;
expect(target.underline).toEqual(WD_UNDERLINE.DOUBLE);
});

it("workflow-496 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = null;
expect(target.underline).toEqual(null);
});

it("workflow-497 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = true;
expect(target.underline).toEqual(true);
});

it("workflow-498 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = false;
expect(target.underline).toEqual(false);
});

it("workflow-499 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = WD_UNDERLINE.SINGLE;
expect(target.underline).toEqual(true);
});

it("workflow-500 observes font underline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:u w:val=\"single\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.underline = WD_UNDERLINE.DOUBLE;
expect(target.underline).toEqual(WD_UNDERLINE.DOUBLE);
});

it("workflow-501 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect([target.subscript, target.superscript]).toEqual([null, null]);
});

it("workflow-502 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect([target.subscript, target.superscript]).toEqual([true, false]);
});

it("workflow-503 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 expect([target.subscript, target.superscript]).toEqual([false, true]);
});

it("workflow-504 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = true;
expect(target.subscript).toBe(true);
});

it("workflow-505 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = true;
expect(target.superscript).toBe(false);
});

it("workflow-506 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = false;
expect(target.subscript).toBe(null);
});

it("workflow-507 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = true;
expect(target.superscript).toBe(true);
});

it("workflow-508 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = true;
expect(target.subscript).toBe(false);
});

it("workflow-509 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = false;
expect(target.superscript).toBe(null);
});

it("workflow-510 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = true;
expect(target.subscript).toBe(true);
});

it("workflow-511 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = false;
expect(target.subscript).toBe(null);
});

it("workflow-512 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = null;
expect(target.subscript).toBe(null);
});

it("workflow-513 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = true;
expect(target.subscript).toBe(false);
});

it("workflow-514 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = false;
expect(target.subscript).toBe(true);
});

it("workflow-515 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = null;
expect(target.subscript).toBe(null);
});

it("workflow-516 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = true;
expect(target.superscript).toBe(true);
});

it("workflow-517 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = false;
expect(target.superscript).toBe(null);
});

it("workflow-518 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.superscript = null;
expect(target.superscript).toBe(null);
});

it("workflow-519 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = true;
expect(target.superscript).toBe(false);
});

it("workflow-520 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = false;
expect(target.superscript).toBe(true);
});

it("workflow-521 observes font vertical alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.subscript = null;
expect(target.superscript).toBe(null);
});

it("workflow-522 observes font all_caps variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.all_caps = true;
expect(target.all_caps).toBe(true);
});

it("workflow-523 observes font bold variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.bold = true;
expect(target.bold).toBe(true);
});

it("workflow-524 observes font complex_script variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.complex_script = true;
expect(target.complex_script).toBe(true);
});

it("workflow-525 observes font cs_bold variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.cs_bold = true;
expect(target.cs_bold).toBe(true);
});

it("workflow-526 observes font cs_italic variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.cs_italic = true;
expect(target.cs_italic).toBe(true);
});

it("workflow-527 observes font double_strike variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.double_strike = true;
expect(target.double_strike).toBe(true);
});

it("workflow-528 observes font emboss variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.emboss = true;
expect(target.emboss).toBe(true);
});

it("workflow-529 observes font hidden variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.hidden = true;
expect(target.hidden).toBe(true);
});

it("workflow-530 observes font italic variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.italic = true;
expect(target.italic).toBe(true);
});

it("workflow-531 observes font imprint variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.imprint = true;
expect(target.imprint).toBe(true);
});

it("workflow-532 observes font math variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.math = true;
expect(target.math).toBe(true);
});

it("workflow-533 observes font no_proof variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.no_proof = true;
expect(target.no_proof).toBe(true);
});

it("workflow-534 observes font outline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.outline = true;
expect(target.outline).toBe(true);
});

it("workflow-535 observes font rtl variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.rtl = true;
expect(target.rtl).toBe(true);
});

it("workflow-536 observes font shadow variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.shadow = true;
expect(target.shadow).toBe(true);
});

it("workflow-537 observes font small_caps variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.small_caps = true;
expect(target.small_caps).toBe(true);
});

it("workflow-538 observes font snap_to_grid variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.snap_to_grid = true;
expect(target.snap_to_grid).toBe(true);
});

it("workflow-539 observes font spec_vanish variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.spec_vanish = true;
expect(target.spec_vanish).toBe(true);
});

it("workflow-540 observes font strike variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.strike = true;
expect(target.strike).toBe(true);
});

it("workflow-541 observes font web_hidden variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.web_hidden = true;
expect(target.web_hidden).toBe(true);
});

it("workflow-542 observes font all_caps variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.all_caps = false;
expect(target.all_caps).toBe(false);
});

it("workflow-543 observes font bold variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.bold = false;
expect(target.bold).toBe(false);
});

it("workflow-544 observes font complex_script variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.complex_script = false;
expect(target.complex_script).toBe(false);
});

it("workflow-545 observes font cs_bold variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.cs_bold = false;
expect(target.cs_bold).toBe(false);
});

it("workflow-546 observes font cs_italic variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.cs_italic = false;
expect(target.cs_italic).toBe(false);
});

it("workflow-547 observes font double_strike variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.double_strike = false;
expect(target.double_strike).toBe(false);
});

it("workflow-548 observes font emboss variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.emboss = false;
expect(target.emboss).toBe(false);
});

it("workflow-549 observes font hidden variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.hidden = false;
expect(target.hidden).toBe(false);
});

it("workflow-550 observes font italic variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.italic = false;
expect(target.italic).toBe(false);
});

it("workflow-551 observes font imprint variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.imprint = false;
expect(target.imprint).toBe(false);
});

it("workflow-552 observes font math variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.math = false;
expect(target.math).toBe(false);
});

it("workflow-553 observes font no_proof variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.no_proof = false;
expect(target.no_proof).toBe(false);
});

it("workflow-554 observes font outline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.outline = false;
expect(target.outline).toBe(false);
});

it("workflow-555 observes font rtl variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.rtl = false;
expect(target.rtl).toBe(false);
});

it("workflow-556 observes font shadow variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.shadow = false;
expect(target.shadow).toBe(false);
});

it("workflow-557 observes font small_caps variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.small_caps = false;
expect(target.small_caps).toBe(false);
});

it("workflow-558 observes font snap_to_grid variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.snap_to_grid = false;
expect(target.snap_to_grid).toBe(false);
});

it("workflow-559 observes font spec_vanish variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.spec_vanish = false;
expect(target.spec_vanish).toBe(false);
});

it("workflow-560 observes font strike variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.strike = false;
expect(target.strike).toBe(false);
});

it("workflow-561 observes font web_hidden variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.web_hidden = false;
expect(target.web_hidden).toBe(false);
});

it("workflow-562 observes font all_caps variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.all_caps = null;
expect(target.all_caps).toBe(null);
});

it("workflow-563 observes font bold variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.bold = null;
expect(target.bold).toBe(null);
});

it("workflow-564 observes font complex_script variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:cs/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.complex_script = null;
expect(target.complex_script).toBe(null);
});

it("workflow-565 observes font cs_bold variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.cs_bold = null;
expect(target.cs_bold).toBe(null);
});

it("workflow-566 observes font cs_italic variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:iCs/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.cs_italic = null;
expect(target.cs_italic).toBe(null);
});

it("workflow-567 observes font double_strike variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:dstrike/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.double_strike = null;
expect(target.double_strike).toBe(null);
});

it("workflow-568 observes font emboss variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:emboss/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.emboss = null;
expect(target.emboss).toBe(null);
});

it("workflow-569 observes font hidden variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.hidden = null;
expect(target.hidden).toBe(null);
});

it("workflow-570 observes font italic variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.italic = null;
expect(target.italic).toBe(null);
});

it("workflow-571 observes font imprint variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:imprint/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.imprint = null;
expect(target.imprint).toBe(null);
});

it("workflow-572 observes font math variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:oMath/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.math = null;
expect(target.math).toBe(null);
});

it("workflow-573 observes font no_proof variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:noProof/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.no_proof = null;
expect(target.no_proof).toBe(null);
});

it("workflow-574 observes font outline variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:outline/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.outline = null;
expect(target.outline).toBe(null);
});

it("workflow-575 observes font rtl variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:rtl/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.rtl = null;
expect(target.rtl).toBe(null);
});

it("workflow-576 observes font shadow variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:shadow/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.shadow = null;
expect(target.shadow).toBe(null);
});

it("workflow-577 observes font small_caps variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:smallCaps/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.small_caps = null;
expect(target.small_caps).toBe(null);
});

it("workflow-578 observes font snap_to_grid variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:snapToGrid/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.snap_to_grid = null;
expect(target.snap_to_grid).toBe(null);
});

it("workflow-579 observes font spec_vanish variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:specVanish/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.spec_vanish = null;
expect(target.spec_vanish).toBe(null);
});

it("workflow-580 observes font strike variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.strike = null;
expect(target.strike).toBe(null);
});

it("workflow-581 observes font web_hidden variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:webHidden/></w:rPr><w:t>Original signal</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font;
 target.web_hidden = null;
expect(target.web_hidden).toBe(null);
});
it("workflow-583 observes paragraph alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.alignment).toEqual(null);
});

it("workflow-584 observes paragraph alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.alignment).toEqual(WD_ALIGN_PARAGRAPH.CENTER);
});

it("workflow-585 observes paragraph alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:jc w:val=\"right\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.alignment).toEqual(WD_ALIGN_PARAGRAPH.RIGHT);
});

it("workflow-586 observes paragraph alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.alignment = WD_ALIGN_PARAGRAPH.CENTER;
expect(target.alignment).toEqual(WD_ALIGN_PARAGRAPH.CENTER);
});

it("workflow-587 observes paragraph alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.alignment = WD_ALIGN_PARAGRAPH.RIGHT;
expect(target.alignment).toEqual(WD_ALIGN_PARAGRAPH.RIGHT);
});

it("workflow-588 observes paragraph alignment variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:jc w:val=\"right\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.alignment = null;
expect(target.alignment).toEqual(null);
});

it("workflow-589 observes paragraph space_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.space_before as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-590 observes paragraph space_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:before=\"480\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.space_before as Length | null)?.emu ?? null).toEqual(304800);
});

it("workflow-591 observes paragraph space_after variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.space_after as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-592 observes paragraph space_after variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:after=\"840\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.space_after as Length | null)?.emu ?? null).toEqual(533400);
});

it("workflow-593 observes paragraph space_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.space_before = Pt(12);
expect((target.space_before as Length | null)?.emu ?? null).toEqual(152400);
});

it("workflow-594 observes paragraph space_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:before=\"480\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.space_before = Pt(18);
expect((target.space_before as Length | null)?.emu ?? null).toEqual(228600);
});

it("workflow-595 observes paragraph space_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:before=\"480\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.space_before = null;
expect((target.space_before as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-596 observes paragraph space_after variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.space_after = Pt(12);
expect((target.space_after as Length | null)?.emu ?? null).toEqual(152400);
});

it("workflow-597 observes paragraph space_after variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:after=\"840\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.space_after = Pt(18);
expect((target.space_after as Length | null)?.emu ?? null).toEqual(228600);
});

it("workflow-598 observes paragraph space_after variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:after=\"840\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.space_after = null;
expect((target.space_after as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-611 observes paragraph first_line_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.first_line_indent as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-612 observes paragraph first_line_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:firstLine=\"360\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.first_line_indent as Length | null)?.emu ?? null).toEqual(228600);
});

it("workflow-613 observes paragraph first_line_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:hanging=\"346\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.first_line_indent as Length | null)?.emu ?? null).toEqual(-219710);
});

it("workflow-614 observes paragraph left_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.left_indent as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-615 observes paragraph left_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:left=\"922\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.left_indent as Length | null)?.emu ?? null).toEqual(585470);
});

it("workflow-616 observes paragraph right_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.right_indent as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-617 observes paragraph right_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:right=\"346\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.right_indent as Length | null)?.emu ?? null).toEqual(219710);
});

it("workflow-618 observes paragraph first_line_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.first_line_indent = Pt(18);
expect((target.first_line_indent as Length | null)?.emu ?? null).toEqual(228600);
});

it("workflow-619 observes paragraph first_line_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:firstLine=\"360\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.first_line_indent = Pt(-18);
expect((target.first_line_indent as Length | null)?.emu ?? null).toEqual(-228600);
});

it("workflow-620 observes paragraph first_line_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:hanging=\"346\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.first_line_indent = null;
expect((target.first_line_indent as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-621 observes paragraph left_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.left_indent = Pt(36);
expect((target.left_indent as Length | null)?.emu ?? null).toEqual(457200);
});

it("workflow-622 observes paragraph left_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:left=\"922\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.left_indent = Pt(-12);
expect((target.left_indent as Length | null)?.emu ?? null).toEqual(-152400);
});

it("workflow-623 observes paragraph left_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:left=\"922\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.left_indent = null;
expect((target.left_indent as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-624 observes paragraph right_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.right_indent = Pt(24);
expect((target.right_indent as Length | null)?.emu ?? null).toEqual(304800);
});

it("workflow-625 observes paragraph right_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:right=\"346\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.right_indent = Pt(-6);
expect((target.right_indent as Length | null)?.emu ?? null).toEqual(-76200);
});

it("workflow-626 observes paragraph right_indent variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:ind w:right=\"346\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.right_indent = null;
expect((target.right_indent as Length | null)?.emu ?? null).toEqual(null);
});

it("workflow-627 observes paragraph keep_together variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.keep_together).toEqual(null);
});

it("workflow-628 observes paragraph keep_together variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepLines w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.keep_together).toEqual(true);
});

it("workflow-629 observes paragraph keep_together variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepLines w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.keep_together).toEqual(false);
});

it("workflow-630 observes paragraph keep_with_next variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.keep_with_next).toEqual(null);
});

it("workflow-631 observes paragraph keep_with_next variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepNext w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.keep_with_next).toEqual(true);
});

it("workflow-632 observes paragraph keep_with_next variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepNext w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.keep_with_next).toEqual(false);
});

it("workflow-633 observes paragraph page_break_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.page_break_before).toEqual(null);
});

it("workflow-634 observes paragraph page_break_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:pageBreakBefore w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.page_break_before).toEqual(true);
});

it("workflow-635 observes paragraph page_break_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:pageBreakBefore w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.page_break_before).toEqual(false);
});

it("workflow-636 observes paragraph widow_control variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.widow_control).toEqual(null);
});

it("workflow-637 observes paragraph widow_control variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:widowControl w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.widow_control).toEqual(true);
});

it("workflow-638 observes paragraph widow_control variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:widowControl w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.widow_control).toEqual(false);
});

it("workflow-639 observes paragraph keep_together variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.keep_together = true;
expect(target.keep_together).toEqual(true);
});

it("workflow-640 observes paragraph keep_together variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepLines w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.keep_together = false;
expect(target.keep_together).toEqual(false);
});

it("workflow-641 observes paragraph keep_together variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepLines w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.keep_together = null;
expect(target.keep_together).toEqual(null);
});

it("workflow-642 observes paragraph keep_with_next variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.keep_with_next = false;
expect(target.keep_with_next).toEqual(false);
});

it("workflow-643 observes paragraph keep_with_next variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepNext w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.keep_with_next = true;
expect(target.keep_with_next).toEqual(true);
});

it("workflow-644 observes paragraph keep_with_next variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:keepNext w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.keep_with_next = null;
expect(target.keep_with_next).toEqual(null);
});

it("workflow-645 observes paragraph page_break_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.page_break_before = true;
expect(target.page_break_before).toEqual(true);
});

it("workflow-646 observes paragraph page_break_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:pageBreakBefore w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.page_break_before = false;
expect(target.page_break_before).toEqual(false);
});

it("workflow-647 observes paragraph page_break_before variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:pageBreakBefore w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.page_break_before = null;
expect(target.page_break_before).toEqual(null);
});

it("workflow-648 observes paragraph widow_control variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.widow_control = false;
expect(target.widow_control).toEqual(false);
});

it("workflow-649 observes paragraph widow_control variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:widowControl w:val=\"0\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.widow_control = true;
expect(target.widow_control).toEqual(true);
});

it("workflow-650 observes paragraph widow_control variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:widowControl w:val=\"1\"/></w:pPr><w:r><w:t>Original interval</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.widow_control = null;
expect(target.widow_control).toEqual(null);
});
it("workflow-339 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4 5 6 7 8 9");
});

it("workflow-340 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4 4 6 7 8 9");
});

it("workflow-341 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4 5 6 7 5 9");
});

it("workflow-342 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4 4 6 4 4 9");
});

it("workflow-343 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.columns].flatMap(column => column.cells).map(cell => cell.text).join(" ")).toBe("1 4 7 2 5 8 3 6 9");
});

it("workflow-344 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.columns].flatMap(column => column.cells).map(cell => cell.text).join(" ")).toBe("1 4 7 2 4 8 3 6 9");
});

it("workflow-345 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.columns].flatMap(column => column.cells).map(cell => cell.text).join(" ")).toBe("1 4 7 2 5 5 3 6 9");
});

it("workflow-346 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect([...table.columns].flatMap(column => column.cells).map(cell => cell.text).join(" ")).toBe("1 4 4 2 4 4 3 6 9");
});

it("workflow-347 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect(table.cell(1,1).text).toBe("5");
});

it("workflow-348 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect(table.cell(1,1).text).toBe("4");
});

it("workflow-349 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect(table.cell(2,1).text).toBe("5");
});

it("workflow-350 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 expect(table.cell(2,1).text).toBe("4");
});

it("workflow-378 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(0,0).merge(table.cell(0,1));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1\n2 1\n2 3 4 5 6 7 8 9");
});

it("workflow-379 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(0,1).merge(table.cell(1,1));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2\n5 3 4 2\n5 6 7 8 9");
});

it("workflow-380 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(1,1).merge(table.cell(2,2));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4 5\n6\n8\n9 5\n6\n8\n9 7 5\n6\n8\n9 5\n6\n8\n9");
});

it("workflow-381 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(1,0).merge(table.cell(2,1));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4\n7\n8 4\n7\n8 6 4\n7\n8 4\n7\n8 9");
});

it("workflow-382 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(1,0).merge(table.cell(1,2));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4\n6 4\n6 4\n6 7 8 9");
});

it("workflow-383 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(0,1).merge(table.cell(1,0));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1\n2\n4 1\n2\n4 3 1\n2\n4 1\n2\n4 6 7 8 9");
});

it("workflow-384 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(1,1).merge(table.cell(2,2));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4 5\n6\n9 5\n6\n9 7 5\n6\n9 5\n6\n9");
});

it("workflow-385 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(0,1).merge(table.cell(1,1));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2\n5 3 4 2\n5 6 7 2\n5 9");
});

it("workflow-386 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(2,0).merge(table.cell(1,1));
expect([...table.rows].flatMap(row => row.cells).map(cell => cell.text).join(" ")).toBe("1 2 3 4\n5\n7 4\n5\n7 6 4\n5\n7 4\n5\n7 9");
});

it("workflow-387 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(0,0).merge(table.cell(0,1));
expect(table.cell(0,0).width?.inches).toBe(2.0);
});

it("workflow-388 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(0,0).merge(table.cell(1,1));
expect(table.cell(0,0).width?.inches).toBe(2.0);
});

it("workflow-389 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"2880\"/><w:gridSpan w:val=\"2\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(1,0).merge(table.cell(1,2));
expect(table.cell(1,0).width?.inches).toBe(3.0);
});

it("workflow-390 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(1,1).merge(table.cell(0,1));
expect(table.cell(0,1).width?.inches).toBe(1.0);
});

it("workflow-391 observes logical grid content variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge w:val=\"restart\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"), textContext);
 const table = document.tables[0]!;
 table.cell(1,1).merge(table.cell(2,0));
expect(table.cell(1,1).width?.inches).toBe(2.0);
});
it("workflow-446 observes font color type variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.type).toEqual(null);
});

it("workflow-447 observes font color type variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"auto\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.type).toEqual(MSO_COLOR_TYPE.AUTO);
});

it("workflow-448 observes font color type variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"008000\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.type).toEqual(MSO_COLOR_TYPE.RGB);
});

it("workflow-449 observes font color type variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"4F81BD\" w:themeColor=\"accent1\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.type).toEqual(MSO_COLOR_TYPE.THEME);
});

it("workflow-450 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe(null);
});

it("workflow-451 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"auto\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe(null);
});

it("workflow-452 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"008000\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe("008000");
});

it("workflow-453 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"4F81BD\" w:themeColor=\"accent1\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe("4F81BD");
});

it("workflow-454 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.rgb = RGBColor.from_string("f00ba5");
expect(target.type).toEqual(MSO_COLOR_TYPE.RGB);
expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe("F00BA5");
});

it("workflow-455 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"auto\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.rgb = RGBColor.from_string("2468ac");
expect(target.type).toEqual(MSO_COLOR_TYPE.RGB);
expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe("2468AC");
});

it("workflow-456 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"008000\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.rgb = RGBColor.from_string("feeb1e");
expect(target.type).toEqual(MSO_COLOR_TYPE.RGB);
expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe("FEEB1E");
});

it("workflow-457 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"4F81BD\" w:themeColor=\"accent1\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.rgb = RGBColor.from_string("987bac");
expect(target.type).toEqual(MSO_COLOR_TYPE.RGB);
expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe("987BAC");
});

it("workflow-458 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"008000\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.rgb = null;
expect(target.type).toEqual(null);
expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe(null);
});

it("workflow-459 observes font color rgb variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"4F81BD\" w:themeColor=\"accent1\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.rgb = null;
expect(target.type).toEqual(null);
expect((target.rgb as RGBColor | null)?.toString() ?? null).toBe(null);
});

it("workflow-460 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.theme_color).toEqual(null);
});

it("workflow-461 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"auto\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.theme_color).toEqual(null);
});

it("workflow-462 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"008000\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.theme_color).toEqual(null);
});

it("workflow-463 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"4F81BD\" w:themeColor=\"accent1\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 expect(target.theme_color).toEqual(MSO_THEME_COLOR_INDEX.ACCENT_1);
});

it("workflow-464 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.theme_color = MSO_THEME_COLOR_INDEX.ACCENT_2;
expect(target.type).toEqual(MSO_COLOR_TYPE.THEME);
expect(target.theme_color).toEqual(MSO_THEME_COLOR_INDEX.ACCENT_2);
});

it("workflow-465 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"auto\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.theme_color = MSO_THEME_COLOR_INDEX.DARK_1;
expect(target.type).toEqual(MSO_COLOR_TYPE.THEME);
expect(target.theme_color).toEqual(MSO_THEME_COLOR_INDEX.DARK_1);
});

it("workflow-466 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"008000\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.theme_color = MSO_THEME_COLOR_INDEX.TEXT_1;
expect(target.type).toEqual(MSO_COLOR_TYPE.THEME);
expect(target.theme_color).toEqual(MSO_THEME_COLOR_INDEX.TEXT_1);
});

it("workflow-467 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"4F81BD\" w:themeColor=\"accent1\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.theme_color = MSO_THEME_COLOR_INDEX.LIGHT_2;
expect(target.type).toEqual(MSO_COLOR_TYPE.THEME);
expect(target.theme_color).toEqual(MSO_THEME_COLOR_INDEX.LIGHT_2);
});

it("workflow-468 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"4F81BD\" w:themeColor=\"accent1\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.theme_color = null;
expect(target.type).toEqual(null);
expect(target.theme_color).toEqual(null);
});

it("workflow-469 observes font color theme_color variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:rPr><w:color w:val=\"008000\"/></w:rPr><w:t>Original pigment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!.font.color;
 target.theme_color = null;
expect(target.type).toEqual(null);
expect(target.theme_color).toEqual(null);
});
it("workflow-599 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.line_spacing).toBe(null);
expect(target.line_spacing_rule).toEqual(null);
});

it("workflow-600 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"280\" w:lineRule=\"exact\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect((target.line_spacing as Length).emu).toBe(177800);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.EXACTLY);
});

it("workflow-601 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"480\" w:lineRule=\"auto\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 expect(target.line_spacing).toBe(2.0);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.DOUBLE);
});

it("workflow-602 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing = Pt(14);
expect((target.line_spacing as Length).emu).toBe(177800);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.EXACTLY);
});

it("workflow-603 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"280\" w:lineRule=\"exact\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing = 2;
expect(target.line_spacing).toBe(2.0);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.DOUBLE);
});

it("workflow-604 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"480\" w:lineRule=\"auto\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing = 1.75;
expect(target.line_spacing).toBe(1.75);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.MULTIPLE);
});

it("workflow-605 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing = 1.0;
expect(target.line_spacing).toBe(1.0);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.SINGLE);
});

it("workflow-606 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"280\" w:lineRule=\"exact\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing = 1.5;
expect(target.line_spacing).toBe(1.5);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.ONE_POINT_FIVE);
});

it("workflow-607 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"280\" w:lineRule=\"exact\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing_rule = WD_LINE_SPACING.DOUBLE;
expect(target.line_spacing).toBe(2.0);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.DOUBLE);
});

it("workflow-608 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"480\" w:lineRule=\"auto\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing_rule = WD_LINE_SPACING.SINGLE;
expect(target.line_spacing).toBe(1.0);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.SINGLE);
});

it("workflow-609 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"280\" w:lineRule=\"exact\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing_rule = WD_LINE_SPACING.AT_LEAST;
expect((target.line_spacing as Length).emu).toBe(177800);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.AT_LEAST);
});

it("workflow-610 observes line spacing variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:spacing w:line=\"280\" w:lineRule=\"exact\"/></w:pPr><w:r><w:t>Original cadence</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.paragraph_format;
 target.line_spacing_rule = null;
expect(target.line_spacing).toBeCloseTo(1.1666, 3);
expect(target.line_spacing_rule).toEqual(WD_LINE_SPACING.MULTIPLE);
});
it("workflow-177 observes section different_first_page_header_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:titlePg/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.different_first_page_header_footer).toBe(true);
});

it("workflow-178 observes section different_first_page_header_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.different_first_page_header_footer).toBe(false);
});

it("workflow-179 observes section different_first_page_header_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:titlePg/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.different_first_page_header_footer = true;
expect(target.different_first_page_header_footer).toBe(true);
});

it("workflow-180 observes section different_first_page_header_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:titlePg/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.different_first_page_header_footer = false;
expect(target.different_first_page_header_footer).toBe(false);
});

it("workflow-181 observes section different_first_page_header_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.different_first_page_header_footer = true;
expect(target.different_first_page_header_footer).toBe(true);
});

it("workflow-182 observes section different_first_page_header_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.different_first_page_header_footer = false;
expect(target.different_first_page_header_footer).toBe(false);
});

it("workflow-183 observes section even_page_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.even_page_footer).toBeInstanceOf(_Footer);
});

it("workflow-184 observes section even_page_header variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.even_page_header).toBeInstanceOf(_Header);
});

it("workflow-185 observes section first_page_footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.first_page_footer).toBeInstanceOf(_Footer);
});

it("workflow-186 observes section first_page_header variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.first_page_header).toBeInstanceOf(_Header);
});

it("workflow-187 observes section footer variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.footer).toBeInstanceOf(_Footer);
});

it("workflow-188 observes section header variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.header).toBeInstanceOf(_Header);
});

it("workflow-190 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"continuous\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.start_type).toEqual(WD_SECTION_START.CONTINUOUS);
});

it("workflow-191 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"nextColumn\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.start_type).toEqual(WD_SECTION_START.NEW_COLUMN);
});

it("workflow-192 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"nextPage\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.start_type).toEqual(WD_SECTION_START.NEW_PAGE);
});

it("workflow-193 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"evenPage\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.start_type).toEqual(WD_SECTION_START.EVEN_PAGE);
});

it("workflow-194 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"oddPage\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.start_type).toEqual(WD_SECTION_START.ODD_PAGE);
});

it("workflow-195 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"continuous\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.start_type = WD_SECTION_START.NEW_PAGE;
expect(target.start_type).toEqual(WD_SECTION_START.NEW_PAGE);
});

it("workflow-196 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"nextPage\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.start_type = WD_SECTION_START.ODD_PAGE;
expect(target.start_type).toEqual(WD_SECTION_START.ODD_PAGE);
});

it("workflow-197 observes section start_type variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:type w:val=\"nextColumn\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.start_type = null;
expect(target.start_type).toEqual(WD_SECTION_START.NEW_PAGE);
});

it("workflow-198 observes section page_width/page_height variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect([target.page_width?.inches, target.page_height?.inches]).toEqual([8.5,11]);
});

it("workflow-199 observes section page_width/page_height variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.page_width = Inches(11); target.page_height = Inches(8.5);
expect([target.page_width?.inches, target.page_height?.inches]).toEqual([11,8.5]);
});

it("workflow-200 observes section orientation variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\" w:orient=\"landscape\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.orientation).toEqual(WD_ORIENT.LANDSCAPE);
});

it("workflow-201 observes section orientation variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\" w:orient=\"portrait\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect(target.orientation).toEqual(WD_ORIENT.PORTRAIT);
});

it("workflow-202 observes section orientation variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\" w:orient=\"portrait\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.orientation = WD_ORIENT.LANDSCAPE;
expect(target.orientation).toEqual(WD_ORIENT.LANDSCAPE);
});

it("workflow-203 observes section orientation variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\" w:orient=\"landscape\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.orientation = WD_ORIENT.PORTRAIT;
expect(target.orientation).toEqual(WD_ORIENT.PORTRAIT);
});

it("workflow-204 observes section orientation variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\" w:orient=\"landscape\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.orientation = null;
expect(target.orientation).toEqual(WD_ORIENT.PORTRAIT);
});

it("workflow-205 observes section margins variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 expect([target.left_margin?.inches,target.right_margin?.inches,target.top_margin?.inches,target.bottom_margin?.inches,target.gutter?.inches,target.header_distance?.inches,target.footer_distance?.inches]).toEqual([1,1.25,1.5,1.75,0.25,0.5,0.75]);
});

it("workflow-206 observes section left_margin variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.left_margin = Inches(1.0);
expect(target.left_margin?.inches).toBe(1.0);
});

it("workflow-207 observes section right_margin variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.right_margin = Inches(1.25);
expect(target.right_margin?.inches).toBe(1.25);
});

it("workflow-208 observes section top_margin variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.top_margin = Inches(0.75);
expect(target.top_margin?.inches).toBe(0.75);
});

it("workflow-209 observes section bottom_margin variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.bottom_margin = Inches(1.5);
expect(target.bottom_margin?.inches).toBe(1.5);
});

it("workflow-210 observes section header_distance variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.header_distance = Inches(0.25);
expect(target.header_distance?.inches).toBe(0.25);
});

it("workflow-211 observes section footer_distance variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.footer_distance = Inches(0.5);
expect(target.footer_distance?.inches).toBe(0.5);
});

it("workflow-212 observes section gutter variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:pgMar w:left=\"1440\" w:right=\"1800\" w:top=\"2160\" w:bottom=\"2520\" w:gutter=\"360\" w:header=\"720\" w:footer=\"1080\"/></w:sectPr>"), textContext);
 const target = document.sections.at(0);
 target.gutter = Inches(0.25);
expect(target.gutter?.inches).toBe(0.25);
});
it("workflow-068 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
target.is_linked_to_previous = false;
expect(target.is_linked_to_previous).toBe(false);
});

it("workflow-069 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
expect(target.is_linked_to_previous).toBe(true);
});

it("workflow-070 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
target.is_linked_to_previous = false;
target.is_linked_to_previous = true;
expect(target.is_linked_to_previous).toBe(true);
});

it("workflow-071 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
target.is_linked_to_previous = false;
expect(target.is_linked_to_previous).toBe(false);
});

it("workflow-072 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
target.is_linked_to_previous = false;
target.is_linked_to_previous = false;
expect(target.is_linked_to_previous).toBe(false);
});

it("workflow-073 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
target.is_linked_to_previous = true;
expect(target.is_linked_to_previous).toBe(true);
});

it("workflow-074 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
target.paragraphs[0]!.text = "Original coastal banner";
const second = document.add_section().header;
expect(second.paragraphs[0]!.text).toBe(target.paragraphs[0]!.text);
expect(second.is_linked_to_previous).toBe(true);
});

it("workflow-075 observes header binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).header;
target.paragraphs[0]!.style = "Normal";
expect(target.paragraphs[0]!.style!.name).toBe("Normal");
});

it("workflow-077 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
target.is_linked_to_previous = false;
expect(target.is_linked_to_previous).toBe(false);
});

it("workflow-078 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
expect(target.is_linked_to_previous).toBe(true);
});

it("workflow-079 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
target.is_linked_to_previous = false;
target.is_linked_to_previous = true;
expect(target.is_linked_to_previous).toBe(true);
});

it("workflow-080 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
target.is_linked_to_previous = false;
expect(target.is_linked_to_previous).toBe(false);
});

it("workflow-081 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
target.is_linked_to_previous = false;
target.is_linked_to_previous = false;
expect(target.is_linked_to_previous).toBe(false);
});

it("workflow-082 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
target.is_linked_to_previous = true;
expect(target.is_linked_to_previous).toBe(true);
});

it("workflow-083 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
target.paragraphs[0]!.text = "Original coastal banner";
const second = document.add_section().footer;
expect(second.paragraphs[0]!.text).toBe(target.paragraphs[0]!.text);
expect(second.is_linked_to_previous).toBe(true);
});

it("workflow-084 observes footer binding variant", async () => {
 const document = await Document(undefined, textContext);
 const target = document.sections.at(0).footer;
target.paragraphs[0]!.style = "Normal";
expect(target.paragraphs[0]!.style!.name).toBe("Normal");
});
it("workflow-010 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment();
expect(target.comment_id).toBe(0); expect(target.paragraphs).toHaveLength(1); expect(target.paragraphs[0]!.style!.name).toBe("Comment Text"); expect(comments.length).toBe(1); expect(comments.get(0)?.equals(target)).toBe(true);
});

it("workflow-011 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("", "Taylor Reed", "TR");
expect([target.author,target.initials]).toEqual(["Taylor Reed","TR"]);
});

it("workflow-012 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
const added = target.add_paragraph("Original continuation", "Normal"); expect(target.paragraphs).toHaveLength(2); expect(added.text).toBe("Original continuation"); expect(added.style!.name).toBe("Normal"); expect(target.paragraphs.at(-1)?.equals(added)).toBe(true);
});

it("workflow-013 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
const added = target.add_paragraph(); expect(target.paragraphs).toHaveLength(2); expect(added.text).toBe(""); expect(added.style!.name).toBe("Comment Text"); expect(target.paragraphs.at(-1)?.equals(added)).toBe(true);
});

it("workflow-015 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
target.author = "Morgan Lake"; expect(target.author).toBe("Morgan Lake");
});

it("workflow-016 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
target.initials = "ML"; expect(target.initials).toBe("ML");
});

it("workflow-017 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
expect(target.comment_id).toBe(0);
});

it("workflow-018 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
expect(target.author).toBe("Taylor Reed");
});

it("workflow-019 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
expect(target.initials).toBe("TR");
});

it("workflow-020 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
expect(target.timestamp?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
});

it("workflow-021 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
const target = comments.add_comment("Original annotation", "Taylor Reed", "TR");
expect(target.paragraphs[0]!.text).toBe("Original annotation");
});

it("workflow-029 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const run = document.paragraphs[0]!.add_run("Original selected signal");
const target = document.add_comment(run, "Original annotation", "Taylor Reed", "TR");
expect([target.text,target.author,target.initials]).toEqual(["Original annotation","Taylor Reed","TR"]);
});

it("workflow-049 observes comment workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>", { comments: { kind: "comments", xml: '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>' } }), { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 expect(document.comments).toBeInstanceOf(Comments);
});

it("workflow-050 observes comment workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>"), { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 expect(document.comments).toBeInstanceOf(Comments);
});

it("workflow-051 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
for (let i = 0; i < 0; i++) comments.add_comment("Original note");
expect(comments.length).toBe(0);
});

it("workflow-052 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
for (let i = 0; i < 4; i++) comments.add_comment("Original note");
expect(comments.length).toBe(4);
});

it("workflow-053 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
for (let i = 0; i < 4; i++) comments.add_comment("Original note");
expect([...comments]).toHaveLength(4); expect([...comments].every(item => item instanceof Comment)).toBe(true);
});

it("workflow-054 observes comment workflow variant", async () => {
 const document = await Document(undefined, { ...textContext, timestamp: new Date("2026-09-15T00:00:00Z") });
 const comments = document.comments;
for (let i = 0; i < 4; i++) comments.add_comment("Original note");
expect(comments.get(2)?.comment_id).toBe(2);
});
it("workflow-111 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.contains_page_break).toBe(false);
});

it("workflow-112 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t><w:lastRenderedPageBreak/><w:t>Original 0</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.contains_page_break).toBe(true);
});

it("workflow-113 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t><w:lastRenderedPageBreak/><w:t>Original 0</w:t><w:lastRenderedPageBreak/><w:t>Original 1</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.contains_page_break).toBe(true);
});

it("workflow-114 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original 0</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.hyperlinks).toHaveLength(0); expect(target.hyperlinks.every(item => item instanceof Hyperlink)).toBe(true);
});

it("workflow-115 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original 0</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 0</w:t></w:r></w:hyperlink><w:r><w:t>Original 1</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.hyperlinks).toHaveLength(1); expect(target.hyperlinks.every(item => item instanceof Hyperlink)).toBe(true);
});

it("workflow-116 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original 0</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 0</w:t></w:r></w:hyperlink><w:r><w:t>Original 1</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 1</w:t></w:r></w:hyperlink><w:r><w:t>Original 2</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 2</w:t></w:r></w:hyperlink><w:r><w:t>Original 3</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.hyperlinks).toHaveLength(3); expect(target.hyperlinks.every(item => item instanceof Hyperlink)).toBe(true);
});

it("workflow-117 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original 0</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 0</w:t></w:r></w:hyperlink><w:r><w:t>Original 1</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 1</w:t></w:r></w:hyperlink><w:r><w:t>Original 2</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 2</w:t></w:r></w:hyperlink><w:r><w:t>Original 3</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect([...target.iter_inner_content()].map(item => item.constructor.name)).toEqual(["Run","Hyperlink","Run","Hyperlink","Run","Hyperlink","Run"]);
});

it("workflow-118 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.rendered_page_breaks).toHaveLength(0); expect(target.rendered_page_breaks.every(item => item instanceof RenderedPageBreak)).toBe(true);
});

it("workflow-119 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t><w:lastRenderedPageBreak/><w:t>Original 0</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.rendered_page_breaks).toHaveLength(1); expect(target.rendered_page_breaks.every(item => item instanceof RenderedPageBreak)).toBe(true);
});

it("workflow-120 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t><w:lastRenderedPageBreak/><w:t>Original 0</w:t><w:lastRenderedPageBreak/><w:t>Original 1</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.rendered_page_breaks).toHaveLength(2); expect(target.rendered_page_breaks.every(item => item instanceof RenderedPageBreak)).toBe(true);
});

it("workflow-121 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original 0</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 0</w:t></w:r></w:hyperlink><w:r><w:t>Original 1</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 1</w:t></w:r></w:hyperlink><w:r><w:t>Original 2</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Link 2</w:t></w:r></w:hyperlink><w:r><w:t>Original 3</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.text).toBe("Original 0Link 0Original 1Link 1Original 2Link 2Original 3");
});

it("workflow-125 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr></w:pPr><w:r><w:t>Original alignment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.alignment).toEqual(null);
});

it("workflow-126 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:jc w:val=\"left\"/></w:pPr><w:r><w:t>Original alignment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.alignment).toEqual(WD_ALIGN_PARAGRAPH.LEFT);
});

it("workflow-127 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr><w:r><w:t>Original alignment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.alignment).toEqual(WD_ALIGN_PARAGRAPH.CENTER);
});

it("workflow-128 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:jc w:val=\"right\"/></w:pPr><w:r><w:t>Original alignment</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 expect(target.alignment).toEqual(WD_ALIGN_PARAGRAPH.RIGHT);
});

it("workflow-138 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original before</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Original link</w:t><w:t> suffix</w:t></w:r></w:hyperlink><w:r><w:lastRenderedPageBreak/></w:r><w:r><w:t>Original after</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 const pageBreak = target.rendered_page_breaks[0]!;
expect(pageBreak.preceding_paragraph_fragment?.text).toBe("Original beforeOriginal link suffix");
});

it("workflow-139 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original before</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Original link</w:t><w:lastRenderedPageBreak/><w:t> suffix</w:t></w:r></w:hyperlink><w:r><w:t>Original after</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 const pageBreak = target.rendered_page_breaks[0]!;
expect(pageBreak.preceding_paragraph_fragment?.text).toBe("Original beforeOriginal link suffix");
});

it("workflow-140 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original before</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Original link</w:t><w:t> suffix</w:t></w:r></w:hyperlink><w:r><w:lastRenderedPageBreak/></w:r><w:r><w:t>Original after</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 const pageBreak = target.rendered_page_breaks[0]!;
expect(pageBreak.following_paragraph_fragment?.text).toBe("Original after");
});

it("workflow-141 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original before</w:t></w:r><w:hyperlink w:anchor=\"original\"><w:r><w:t>Original link</w:t><w:lastRenderedPageBreak/><w:t> suffix</w:t></w:r></w:hyperlink><w:r><w:t>Original after</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!;
 const pageBreak = target.rendered_page_breaks[0]!;
expect(pageBreak.following_paragraph_fragment?.text).toBe("Original after");
});

it("workflow-143 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.contains_page_break).toBe(false);
});

it("workflow-144 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t><w:lastRenderedPageBreak/><w:t>Original 0</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.contains_page_break).toBe(true);
});

it("workflow-145 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t><w:lastRenderedPageBreak/><w:t>Original 0</w:t><w:lastRenderedPageBreak/><w:t>Original 1</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.contains_page_break).toBe(true);
});

it("workflow-146 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original start</w:t><w:lastRenderedPageBreak/><w:t>Original 0</w:t><w:lastRenderedPageBreak/><w:t>Original 1</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect([...target.iter_inner_content()].map(item => typeof item === "string" ? item : item.constructor.name)).toEqual(["Original start","RenderedPageBreak","Original 0","RenderedPageBreak","Original 1"]);
});

it("workflow-147 observes content traversal variant", async () => {
 const document = await Document(await textFixture("<w:p><w:r><w:t>Original first</w:t><w:br/><w:t>Second</w:t><w:cr/><w:t>Third</w:t><w:drawing/><w:t>Fourth</w:t><w:tab/><w:t>Fifth</w:t><w:noBreakHyphen/><w:t>Sixth</w:t><w:ptab/><w:t>Seventh</w:t></w:r></w:p>"), textContext);
 const target = document.paragraphs[0]!.runs[0]!;
 expect(target.text).toBe("Original first\nSecond\nThirdFourth\tFifth-Sixth\tSeventh");
});

function originalPicture(): Uint8Array {
  const width = 150, height = 214;
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header.set([8,6], 8);
  const density = new Uint8Array(9), densityView = new DataView(density.buffer);
  densityView.setUint32(0,2835); densityView.setUint32(4,2835); density[8]=1;
  const pixels = new Uint8Array((width*4+1)*height);
  return joinBytes(Uint8Array.of(137,80,78,71,13,10,26,10), pngChunk("IHDR",header), pngChunk("pHYs",density), pngChunk("IDAT",new Uint8Array(deflateSync(pixels))), pngChunk("IEND",new Uint8Array()));
}
it("workflow-014 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const run = document.comments.add_comment().add_paragraph().add_run();
const shape = await run.add_picture(image);
expect(shape.width.inches).toBeCloseTo(150/72.009,6); expect(run.element.children.at(-1)?.localName).toBe("drawing");
const content = [...run.iter_inner_content()]; expect(content).toHaveLength(1); expect(content[0]).toBeInstanceOf(Drawing); expect((content[0] as Drawing).has_picture).toBe(true);
});

it("workflow-041 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const shape = await document.add_picture(image);
expect(shape.width?.inches).toBeCloseTo(150/72.009,6); expect(shape.height?.inches).toBeCloseTo(214/72.009,6);
expect(document.inline_shapes.length).toBe(1);
});

it("workflow-042 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const shape = await document.add_picture(image, Inches(1.75), Inches(2.5));
expect([shape.width.inches,shape.height.inches]).toEqual([1.75,2.5]);
expect(document.inline_shapes.length).toBe(1);
});

it("workflow-043 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const shape = await document.add_picture(image, Inches(1.5));
expect(shape.height.inches).toBeCloseTo(2.14,2);
expect(document.inline_shapes.length).toBe(1);
});

it("workflow-044 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const shape = await document.add_picture(image, undefined, Inches(1.5));
expect(shape.width.inches).toBeCloseTo(1.05,2);
expect(document.inline_shapes.length).toBe(1);
});

it("workflow-076 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const run = document.sections.at(0).header.paragraphs[0]!.add_run("Original header signal");
const shape = await run.add_picture(image);
expect(shape.width.inches).toBeCloseTo(150/72.009,6); expect(run.element.children.at(-1)?.localName).toBe("drawing");
});

it("workflow-085 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const run = document.sections.at(0).footer.paragraphs[0]!.add_run("Original header signal");
const shape = await run.add_picture(image);
expect(shape.width.inches).toBeCloseTo(150/72.009,6); expect(run.element.children.at(-1)?.localName).toBe("drawing");
});

it("workflow-150 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const run = document.paragraphs[0]!.add_run("Original body signal");
const shape = await run.add_picture(image);
expect(shape.width.inches).toBeCloseTo(150/72.009,6); expect(run.element.children.at(-1)?.localName).toBe("drawing"); expect(document.inline_shapes.length).toBe(1);
});

it("workflow-151 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const table = document.add_table(1,1);
const cell = table.cell(0,0);
const run = cell.add_paragraph().add_run("Original cell signal");
const shape = await run.add_picture(image);
expect(shape.width.inches).toBeCloseTo(150/72.009,6); expect(run.element.children.at(-1)?.localName).toBe("drawing"); expect(document.inline_shapes.length).toBe(1);
});

it("workflow-152 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const table = document.add_table(1,1);
const cell = table.rows.at(0).cells[0]!;
const run = cell.add_paragraph().add_run("Original cell signal");
const shape = await run.add_picture(image);
expect(shape.width.inches).toBeCloseTo(150/72.009,6); expect(run.element.children.at(-1)?.localName).toBe("drawing"); expect(document.inline_shapes.length).toBe(1);
});

it("workflow-153 observes explicit image insertion variant", async () => {
 const document = await Document(undefined, textContext);
 const image = originalPicture();
 const table = document.add_table(1,1);
const cell = table.columns.at(0).cells[0]!;
const run = cell.add_paragraph().add_run("Original cell signal");
const shape = await run.add_picture(image);
expect(shape.width.inches).toBeCloseTo(150/72.009,6); expect(run.element.children.at(-1)?.localName).toBe("drawing"); expect(document.inline_shapes.length).toBe(1);
});
it("workflow-099 observes image dimensions and density variant", async () => {
 const bytes = rasterPng(901,1350, [5906,5906,1]);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/png", 901, 1350, 150.01239999999999, 150.01239999999999]);
});

it("workflow-100 observes image dimensions and density variant", async () => {
 const bytes = rasterPng(150,214, [2835,2835,1]);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/png", 150, 214, 72.009, 72.009]);
});

it("workflow-101 observes image dimensions and density variant", async () => {
 const bytes = rasterJpeg(1504,1936, [1,300,300]);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/jpeg", 1504, 1936, 300, 300]);
});

it("workflow-102 observes image dimensions and density variant", async () => {
 const bytes = rasterJpeg(512,512, [1,72,72]);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/jpeg", 512, 512, 72, 72]);
});

it("workflow-103 observes image dimensions and density variant", async () => {
 const bytes = rasterTiff(true,2,[72,1],[72,1]);
new DataView(bytes.buffer).setUint32(18,512,true); new DataView(bytes.buffer).setUint32(30,512,true);
const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/tiff", 512, 512, 72, 72]);
});

it("workflow-104 observes image dimensions and density variant", async () => {
 const bytes = rasterTiff(true,2,[200,1],[200,1]);
new DataView(bytes.buffer).setUint32(18,1600,true); new DataView(bytes.buffer).setUint32(30,2100,true);
const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/tiff", 1600, 2100, 200, 200]);
});

it("workflow-105 observes image dimensions and density variant", async () => {
 const bytes = rasterJpeg(2048,1536, [1,72,72]);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/jpeg", 2048, 1536, 72, 72]);
});

it("workflow-106 observes image dimensions and density variant", async () => {
 const bytes = rasterJpeg(500,375, [1,256,256]);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/jpeg", 500, 375, 256, 256]);
});

it("workflow-107 observes image dimensions and density variant", async () => {
 const bytes = rasterGif();
new DataView(bytes.buffer).setUint16(6,256,true); new DataView(bytes.buffer).setUint16(8,256,true);
const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/gif", 256, 256, 72, 72]);
});

it("workflow-108 observes image dimensions and density variant", async () => {
 const bytes = rasterBmp(512,512,3780,3780);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/bmp", 512, 512, 96.012, 96.012]);
});

it("workflow-109 observes image dimensions and density variant", async () => {
 const bytes = rasterBmp(640,480,11811,11811);

const image = await Image.from_file(bytes, textContext);
expect([image.content_type,image.px_width,image.px_height,image.horz_dpi,image.vert_dpi]).toEqual(["image/bmp", 640, 480, 299.9994, 299.9994]);
});
it("workflow-086 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 const id = document.part.relate_to("http://yahoo.com/", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", true);
target.element.set_attribute({namespaceURI:"http://schemas.openxmlformats.org/officeDocument/2006/relationships",localName:"id"}, id);
expect(target.address).toBe("http://yahoo.com/");
});

it("workflow-087 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 expect(target.contains_page_break).toBe(false);
});

it("workflow-088 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t><w:lastRenderedPageBreak/></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 expect(target.contains_page_break).toBe(true);
});

it("workflow-089 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"linkedBookmark\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 expect(target.fragment).toBe("linkedBookmark");
});

it("workflow-090 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 expect(target.runs).toHaveLength(1); expect(target.runs.every(item => item instanceof Run)).toBe(true);
});

it("workflow-091 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 expect(target.runs).toHaveLength(2); expect(target.runs.every(item => item instanceof Run)).toBe(true);
});

it("workflow-092 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 expect(target.text).toBe("Original hyperlink");
});

it("workflow-093 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"linkedBookmark\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 expect(target.url).toBe("");
});

it("workflow-094 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 const id = document.part.relate_to("https://foo.com", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", true);
target.element.set_attribute({namespaceURI:"http://schemas.openxmlformats.org/officeDocument/2006/relationships",localName:"id"}, id);
expect(target.url).toBe("https://foo.com");
});

it("workflow-095 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 const id = document.part.relate_to("https://foo.com?q=bar", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", true);
target.element.set_attribute({namespaceURI:"http://schemas.openxmlformats.org/officeDocument/2006/relationships",localName:"id"}, id);
expect(target.url).toBe("https://foo.com?q=bar");
});

it("workflow-096 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"intro\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 const id = document.part.relate_to("http://foo.com/", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", true);
target.element.set_attribute({namespaceURI:"http://schemas.openxmlformats.org/officeDocument/2006/relationships",localName:"id"}, id);
expect(target.url).toBe("http://foo.com/#intro");
});

it("workflow-097 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 const id = document.part.relate_to("https://foo.com?q=bar#baz", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", true);
target.element.set_attribute({namespaceURI:"http://schemas.openxmlformats.org/officeDocument/2006/relationships",localName:"id"}, id);
expect(target.url).toBe("https://foo.com?q=bar#baz");
});

it("workflow-098 observes hyperlink variant", async () => {
 const document = await Document(await textFixture("<w:p><w:hyperlink w:anchor=\"\"><w:r><w:t>Original hyperlink</w:t></w:r></w:hyperlink></w:p>"), textContext);
 const target = document.paragraphs[0]!.hyperlinks[0]!;
 const id = document.part.relate_to("court-exif.jpg", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", true);
target.element.set_attribute({namespaceURI:"http://schemas.openxmlformats.org/officeDocument/2006/relationships",localName:"id"}, id);
expect(target.url).toBe("court-exif.jpg");
});
it("workflow-001 observes original SDK lifecycle variant", async () => {
 const volume = Volume.fromJSON({ "/survey.docx": Buffer.from(await textFixture("<w:p><w:r><w:t>Original admitted signal</w:t></w:r></w:p>")) });
 const document = await Document({ path: "/survey.docx", capability: "survey-input" }, { ...textContext, binaryResolver: { capability: "survey-input", async *open(path) { expect(path).toBe("/survey.docx"); yield new Uint8Array(volume.readFileSync(path) as Buffer); } } });
 expect(document).toBeInstanceOf(DocumentView);
});

it("workflow-002 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 expect(document).toBeInstanceOf(DocumentView);
});

it("workflow-003 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const paragraph=document.add_paragraph(); paragraph.add_run().add_text("Original persisted signal"); const volume=Volume.fromJSON({"/saved":""}); await document.save({async write(bytes){volume.appendFileSync("/saved",bytes);}}); const fresh=await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer),textContext); expect(fresh.paragraphs.at(-1)!.text).toBe("Original persisted signal");
});

it("workflow-004 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table=document.add_table(2,2); expect(document.tables[0]).toBe(table);
});

it("workflow-005 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table=document.add_table(2,2); expect(document.tables[0]).toBe(table);
});

it("workflow-028 observes original SDK lifecycle variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:p/><w:sectPr/>"), textContext);
 expect(document.sections).toBeInstanceOf(Sections); expect(document.sections.length).toBe(3); expect([...document.sections]).toHaveLength(3); for (let index = 0; index < 3; index++) expect(document.sections.at(index)).toBeInstanceOf(Section);
});

it("workflow-037 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const added = document.add_paragraph(); expect(document.paragraphs.at(-1)?.equals(added)).toBe(true); expect(added.text).toBe("");
});

it("workflow-038 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const added = document.add_paragraph("Original paragraph"); expect(document.paragraphs.at(-1)?.equals(added)).toBe(true); expect(added.text).toBe("Original paragraph");
});

it("workflow-039 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const style = document.styles.add_style("Original Body",WD_STYLE_TYPE.PARAGRAPH);
const added = document.add_paragraph("Original paragraph", style); expect(document.paragraphs.at(-1)?.equals(added)).toBe(true); expect(added.text).toBe("Original paragraph"); expect(added.style!.name).toBe("Original Body");
});

it("workflow-040 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 document.styles.add_style("Original Body",WD_STYLE_TYPE.PARAGRAPH);
const added = document.add_paragraph("Original paragraph", "Original Body"); expect(document.paragraphs.at(-1)?.equals(added)).toBe(true); expect(added.text).toBe("Original paragraph"); expect(added.style!.name).toBe("Original Body");
});

it("workflow-047 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const section = document.sections.at(0); section.page_width = Inches(8.5); section.left_margin = Inches(1.25); section.right_margin = Inches(1.25);
 const table=document.add_table(2,2); expect([table.rows.length,table.columns.length]).toEqual([2,2]); expect(table.style!.name).toBe("Normal Table"); expect([...table.columns].map(column=>column.width?.inches)).toEqual([3,3]); expect([...table.rows].flatMap(row=>row.cells).map(cell=>cell.width?.inches)).toEqual([3,3,3,3]);
});

it("workflow-048 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table=document.add_table(2,2, Inches(6)); expect([table.rows.length,table.columns.length]).toEqual([2,2]); const style=document.styles.add_style("Original Grid",WD_STYLE_TYPE.TABLE); table.style=style; expect(table.style!.equals(style)).toBe(true);
});

it("workflow-122 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 expect(document.paragraphs[0]!.paragraph_format).toBeInstanceOf(ParagraphFormat);
});

it("workflow-123 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const added=document.paragraphs[0]!.add_run("Original run"); expect(added.text).toBe("Original run");
});

it("workflow-124 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const style=document.styles.add_style("Original Character",WD_STYLE_TYPE.CHARACTER); const added=document.paragraphs[0]!.add_run("Original run",style); expect(added.style!.equals(style)).toBe(true);
});

it("workflow-129 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const paragraph=document.paragraphs[0]!; paragraph.alignment=WD_ALIGN_PARAGRAPH.CENTER; paragraph.add_run("Original lead").bold=true; expect(paragraph.clear()).toBe(paragraph); expect(paragraph.text).toBe(""); expect(paragraph.alignment).toEqual(WD_ALIGN_PARAGRAPH.CENTER);
});

it("workflow-130 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 document.paragraphs[0]!.text="Original first"; document.add_paragraph("Original second"); document.add_paragraph("Original third"); const style=document.styles.add_style("Original Inserted",WD_STYLE_TYPE.PARAGRAPH); const added=document.paragraphs[1]!.insert_paragraph_before("Original inserted",style); expect(document.paragraphs).toHaveLength(4); expect(document.paragraphs[1]!.equals(added)).toBe(true); expect(added.text).toBe("Original inserted"); expect(added.style!.equals(style)).toBe(true);
});

it("workflow-131 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const paragraph=document.paragraphs[0]!; paragraph.alignment=WD_ALIGN_PARAGRAPH.CENTER; paragraph.add_run("Original lead").bold=true; paragraph.text="Original replacement"; expect(paragraph.text).toBe("Original replacement"); expect(paragraph.alignment).toEqual(WD_ALIGN_PARAGRAPH.CENTER); expect(paragraph.runs[0]!.bold).toBe(null);
});

it("workflow-142 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 expect(document.paragraphs[0]!.add_run().font).toBeInstanceOf(Font);
});

it("workflow-148 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const run=document.paragraphs[0]!.add_run("Original lead"); run.add_tab(); expect(run.text).toBe("Original lead\t"); expect(run.element.children.at(-1)!.localName).toBe("tab");
});

it("workflow-149 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const run=document.paragraphs[0]!.add_run(); run.text="Original\nMiddle\rEnd\tFinal-Tail\tLast"; expect(run.text).toBe("Original\nMiddle\nEnd\tFinal-Tail\tLast");
});

it("workflow-162 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const run=document.paragraphs[0]!.add_run("Original lead"); run.bold=true; expect(run.clear()).toBe(run); expect(run.text).toBe(""); expect(run.bold).toBe(true);
});

it("workflow-337 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table = document.add_table(2,2, Inches(6)); const row = table.add_row(); expect(table.rows.length).toBe(3); expect(row.cells).toHaveLength(2); expect([...table.rows].flatMap(row => row.cells).map(cell => cell.width?.inches)).toEqual(Array(6).fill(3));
});

it("workflow-338 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table = document.add_table(2,2, Inches(6)); const column = table.add_column(Inches(1)); expect(table.columns.length).toBe(3); expect(column.cells).toHaveLength(2); expect(column.width?.inches).toBe(1);
});

it("workflow-351 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const cell=document.add_table(1,1).cell(0,0); cell.width=Inches(3.075); const table=cell.add_table(2,2); expect(cell.tables[0]).toBe(table); expect([table.rows.length,table.columns.length]).toEqual([2,2]); expect([...table.columns].map(column=>column.width?.inches)).toEqual([1.5375,1.5375]); expect([...table.rows].flatMap(row=>row.cells).map(cell=>cell.width?.inches)).toEqual(Array(4).fill(1.5375));
});

it("workflow-366 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const cell = document.add_table(1,1).cell(0,0); cell.text="Original cell"; expect(cell.paragraphs[0]!.runs[0]!.text).toBe("Original cell");
});

it("workflow-374 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table = document.add_table(2,2); const collection = table.rows; expect(collection.length).toBe(2); expect([...collection]).toHaveLength(2); expect(collection.at(0)).toBe(collection[0]); expect(collection.at(1)).toBe(collection[1]);
});

it("workflow-375 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table = document.add_table(2,2); const collection = table.rows; expect(collection.length).toBe(2); expect([...collection]).toHaveLength(2); expect(collection.at(0)).toBe(collection[0]); expect(collection.at(1)).toBe(collection[1]);
});

it("workflow-376 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table = document.add_table(2,2); const collection = table.columns; expect(collection.length).toBe(2); expect([...collection]).toHaveLength(2); expect(collection.at(0)).toBe(collection[0]); expect(collection.at(1)).toBe(collection[1]);
});

it("workflow-377 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const table = document.add_table(2,2); const collection = table.columns; expect(collection.length).toBe(2); expect([...collection]).toHaveLength(2); expect(collection.at(0)).toBe(collection[0]); expect(collection.at(1)).toBe(collection[1]);
});

it("workflow-443 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const run=document.paragraphs[0]!.add_run("Original lead"); run.add_break(WD_BREAK.LINE); const last=run.element.children.at(-1)!; expect(last.localName).toBe("br"); expect(run.text).toBe("Original lead\n");
});

it("workflow-444 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const run=document.paragraphs[0]!.add_run("Original lead"); run.add_break(WD_BREAK.PAGE); const last=run.element.children.at(-1)!; expect(last.localName).toBe("br"); expect([...last.attributes].find(([name])=>name.localName==="type")?.[1]).toBe("page");
});

it("workflow-445 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 const run=document.paragraphs[0]!.add_run("Original lead"); run.add_break(WD_BREAK.COLUMN); const last=run.element.children.at(-1)!; expect(last.localName).toBe("br"); expect([...last.attributes].find(([name])=>name.localName==="type")?.[1]).toBe("column");
});

it("workflow-486 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 expect(document.paragraphs[0]!.add_run().font.color).toBeInstanceOf(ColorFormat);
});

it("workflow-582 observes original SDK lifecycle variant", async () => {
 const document = await Document(undefined, textContext);
 expect(document.paragraphs[0]!.paragraph_format.tab_stops).toBeInstanceOf(TabStops);
});
it("workflow-132 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!;
if (!document.styles.has("Heading 1")) document.styles.add_style("Heading 1", WD_STYLE_TYPE.PARAGRAPH);
if (!document.styles.has("Body Text")) document.styles.add_style("Body Text", WD_STYLE_TYPE.PARAGRAPH);
expect(target.style!.name).toBe("Normal");
});

it("workflow-133 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!;
if (!document.styles.has("Heading 1")) document.styles.add_style("Heading 1", WD_STYLE_TYPE.PARAGRAPH);
if (!document.styles.has("Body Text")) document.styles.add_style("Body Text", WD_STYLE_TYPE.PARAGRAPH);
target.element.insert(0, {kind:"element",name:{namespaceURI:"http://schemas.openxmlformats.org/wordprocessingml/2006/main",localName:"pPr"},children:[{kind:"element",name:{namespaceURI:"http://schemas.openxmlformats.org/wordprocessingml/2006/main",localName:"pStyle"},attributes:[{name:{namespaceURI:"http://schemas.openxmlformats.org/wordprocessingml/2006/main",localName:"val"},value:"OriginalMissing"}]}]});
expect(target.style!.name).toBe("Normal");
});

it("workflow-134 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!;
if (!document.styles.has("Heading 1")) document.styles.add_style("Heading 1", WD_STYLE_TYPE.PARAGRAPH);
if (!document.styles.has("Body Text")) document.styles.add_style("Body Text", WD_STYLE_TYPE.PARAGRAPH);
target.style = "Heading 1";
expect(target.style!.name).toBe("Heading 1");
});

it("workflow-135 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!;
if (!document.styles.has("Heading 1")) document.styles.add_style("Heading 1", WD_STYLE_TYPE.PARAGRAPH);
if (!document.styles.has("Body Text")) document.styles.add_style("Body Text", WD_STYLE_TYPE.PARAGRAPH);
target.style = "Body Text";
expect(target.style!.name).toBe("Body Text");
});

it("workflow-136 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!;
if (!document.styles.has("Heading 1")) document.styles.add_style("Heading 1", WD_STYLE_TYPE.PARAGRAPH);
if (!document.styles.has("Body Text")) document.styles.add_style("Body Text", WD_STYLE_TYPE.PARAGRAPH);
const style=document.styles.at("Body Text") as ParagraphStyle; target.style = style; expect(target.style!.equals(style)).toBe(true);
});

it("workflow-137 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!;
if (!document.styles.has("Heading 1")) document.styles.add_style("Heading 1", WD_STYLE_TYPE.PARAGRAPH);
if (!document.styles.has("Body Text")) document.styles.add_style("Body Text", WD_STYLE_TYPE.PARAGRAPH);
const style=document.styles.at("Body Text") as ParagraphStyle; target.style = "Body Text"; expect(target.style!.equals(style)).toBe(true);
});

it("workflow-154 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
expect(target.style!.name).toBe("Default Paragraph Font");
});

it("workflow-155 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
target.style = "Emphasis";
expect(target.style!.name).toBe("Emphasis");
});

it("workflow-156 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
target.style = "Strong";
expect(target.style!.name).toBe("Strong");
});

it("workflow-157 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
target.style = "Emphasis";
expect(target.style!.name).toBe("Emphasis");
});

it("workflow-158 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
target.style = document.styles.at("Emphasis") as CharacterStyle;
expect(target.style!.name).toBe("Emphasis");
});

it("workflow-159 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
target.style = "Emphasis";
target.style = "Strong";
expect(target.style!.name).toBe("Strong");
});

it("workflow-160 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
target.style = "Emphasis";
target.style = document.styles.at("Strong") as CharacterStyle;
expect(target.style!.name).toBe("Strong");
});

it("workflow-161 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.paragraphs[0]!.add_run();
if (!document.styles.has("Emphasis")) document.styles.add_style("Emphasis", WD_STYLE_TYPE.CHARACTER);
if (!document.styles.has("Strong")) document.styles.add_style("Strong", WD_STYLE_TYPE.CHARACTER);
target.style = "Strong";
target.style = null;
expect(target.style!.name).toBe("Default Paragraph Font");
});

it("workflow-435 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
expect(target.style!.name).toBe("Normal Table");
});

it("workflow-436 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
target.style = "Table Grid";
expect(target.style!.name).toBe("Table Grid");
});

it("workflow-437 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
target.style = "Light Shading Accent 1";
expect(target.style!.name).toBe("Light Shading Accent 1");
});

it("workflow-438 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
target.style = "Table Grid";
expect(target.style!.name).toBe("Table Grid");
});

it("workflow-439 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
target.style = document.styles.at("Table Grid") as TableStyle;
expect(target.style!.name).toBe("Table Grid");
});

it("workflow-440 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
target.style = "Table Grid";
target.style = "Normal Table";
expect(target.style!.name).toBe("Normal Table");
});

it("workflow-441 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
target.style = "Table Grid";
target.style = document.styles.at("Normal Table") as TableStyle;
expect(target.style!.name).toBe("Normal Table");
});

it("workflow-442 observes owner style variant", async () => {
 const document = await Document(undefined,textContext);
 const target = document.add_table(1,1);
if (!document.styles.has("Table Grid")) document.styles.add_style("Table Grid", WD_STYLE_TYPE.TABLE);
if (!document.styles.has("Light Shading Accent 1")) document.styles.add_style("Light Shading Accent 1", WD_STYLE_TYPE.TABLE);
target.style = "Table Grid";
target.style = null;
expect(target.style!.name).toBe("Normal Table");
});
it("workflow-006 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>"),textContext);
 expect([...document.iter_inner_content()].map(item=>item.constructor.name)).toEqual(["Table","Paragraph","Table","Paragraph","Table","Paragraph"]);
});

it("workflow-007 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:headerReference w:type=\"default\" r:id=\"header\"/></w:sectPr>",{header:{kind:"header",xml:"<w:hdr xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:hdr>"}}),textContext);
 expect([...document.sections.at(0).header.iter_inner_content()].map(item=>item.constructor.name)).toEqual(["Table","Paragraph"]);
});

it("workflow-008 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:sectPr><w:footerReference w:type=\"default\" r:id=\"footer\"/></w:sectPr>",{footer:{kind:"footer",xml:"<w:ftr xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:p/><w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:ftr>"}}),textContext);
 expect([...document.sections.at(0).footer.iter_inner_content()].map(item=>item.constructor.name)).toEqual(["Paragraph","Table","Paragraph"]);
});

it("workflow-009 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/><w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:tc></w:tr></w:tbl>"),textContext);
 expect([...document.tables[0]!.cell(0,0).iter_inner_content()].map(item=>item.constructor.name)).toEqual(["Paragraph","Table","Paragraph"]);
});

it("workflow-022 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const comment=document.comments.add_comment(); const run=comment.paragraphs[0]!.add_run(); await run.add_picture(originalPicture()); const drawing=[...run.iter_inner_content()].find(item=>item instanceof Drawing) as Drawing; expect(drawing.has_picture).toBe(true); expect(drawing.image.px_width).toBe(150); expect(drawing.image.px_height).toBe(214);
});

it("workflow-023 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 await document.add_picture(originalPicture()); expect(document.inline_shapes).toBeInstanceOf(InlineShapes);
});

it("workflow-024 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/><w:p/><w:p/>"),textContext);
 expect(document.paragraphs).toHaveLength(3); expect(document.paragraphs.every(item=>item instanceof Paragraph)).toBe(true);
});

it("workflow-025 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 expect(document.sections).toBeInstanceOf(Sections);
});

it("workflow-026 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 expect(document.styles).toBeInstanceOf(Styles);
});

it("workflow-027 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 for(let i=0;i<3;i++) document.add_table(1,1); expect(document.tables).toHaveLength(3); expect(document.tables.every(item=>item instanceof Table)).toBe(true);
});

it("workflow-110 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>", {numbering:{kind:"numbering",xml:"<w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:num w:numId=\"0\"><w:abstractNumId w:val=\"0\"/></w:num><w:num w:numId=\"1\"><w:abstractNumId w:val=\"1\"/></w:num><w:num w:numId=\"2\"><w:abstractNumId w:val=\"2\"/></w:num><w:num w:numId=\"3\"><w:abstractNumId w:val=\"3\"/></w:num><w:num w:numId=\"4\"><w:abstractNumId w:val=\"4\"/></w:num><w:num w:numId=\"5\"><w:abstractNumId w:val=\"5\"/></w:num><w:num w:numId=\"6\"><w:abstractNumId w:val=\"6\"/></w:num><w:num w:numId=\"7\"><w:abstractNumId w:val=\"7\"/></w:num><w:num w:numId=\"8\"><w:abstractNumId w:val=\"8\"/></w:num><w:num w:numId=\"9\"><w:abstractNumId w:val=\"9\"/></w:num></w:numbering>"}}),textContext);
 expect(document.part.numbering_part.numbering_definitions.length).toBe(10);
});

it("workflow-189 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:tbl><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>5</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:type=\"dxa\" w:w=\"1440\"/></w:tcPr><w:p><w:r><w:t>9</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Original middle</w:t></w:r></w:p><w:p/><w:sectPr/>"),textContext);
 expect([...document.sections.at(1).iter_inner_content()].map(item=>item.constructor.name)).toEqual(["Table","Paragraph","Paragraph"]);
});

it("workflow-213 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 for(let i=0;i<5;i++) await document.add_picture(originalPicture()); const shapes=document.inline_shapes; expect(shapes.length).toBe(5); expect([...shapes]).toHaveLength(5); for(let i=0;i<5;i++)expect(shapes.at(i)).toBe(shapes[i]);
});

it("workflow-214 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" xmlns:d=\"http://schemas.openxmlformats.org/drawingml/2006/diagram\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><w:r><w:drawing><wp:inline><wp:extent cx=\"914400\" cy=\"914400\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:blipFill><a:blip r:embed=\"embedded\"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"),textContext);
 expect(document.inline_shapes.at(0).type).toEqual(WD_INLINE_SHAPE.PICTURE);
});

it("workflow-215 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" xmlns:d=\"http://schemas.openxmlformats.org/drawingml/2006/diagram\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><w:r><w:drawing><wp:inline><wp:extent cx=\"914400\" cy=\"914400\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:blipFill><a:blip r:link=\"linked\"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"),textContext);
 expect(document.inline_shapes.at(0).type).toEqual(WD_INLINE_SHAPE.LINKED_PICTURE);
});

it("workflow-216 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" xmlns:d=\"http://schemas.openxmlformats.org/drawingml/2006/diagram\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><w:r><w:drawing><wp:inline><wp:extent cx=\"914400\" cy=\"914400\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:blipFill><a:blip r:link=\"linked\" r:embed=\"embedded\"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"),textContext);
 expect(document.inline_shapes.at(0).type).toEqual(WD_INLINE_SHAPE.LINKED_PICTURE);
});

it("workflow-217 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" xmlns:d=\"http://schemas.openxmlformats.org/drawingml/2006/diagram\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><w:r><w:drawing><wp:inline><wp:extent cx=\"914400\" cy=\"914400\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/diagram\"><d:relIds/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"),textContext);
 expect(document.inline_shapes.at(0).type).toEqual(WD_INLINE_SHAPE.SMART_ART);
});

it("workflow-218 observes final SDK workflow variant", async () => {
 const document = await Document(await textFixture("<w:p xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\" xmlns:d=\"http://schemas.openxmlformats.org/drawingml/2006/diagram\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><w:r><w:drawing><wp:inline><wp:extent cx=\"914400\" cy=\"914400\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><c:chart/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"),textContext);
 expect(document.inline_shapes.at(0).type).toEqual(WD_INLINE_SHAPE.CHART);
});

it("workflow-219 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const shape=await document.add_picture(originalPicture(), Inches(1), Inches(2)); expect([shape.width.inches,shape.height.inches]).toEqual([1,2]);
});

it("workflow-220 observes final SDK workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const shape=await document.add_picture(originalPicture(), Inches(1), Inches(2)); shape.width=Inches(3); shape.height=Inches(4); expect([shape.width.inches,shape.height.inches]).toEqual([3,4]);
});
it("workflow-055 observes original property collection variant", async () => {
 const document = await Document(undefined,{...textContext,timestamp:new Date("2026-09-15T00:00:00Z")});
 const properties=document.core_properties;
properties.author = "Original Creator";
properties.category = "Original Category";
properties.comments = "Original Description";
properties.content_status = "Original Status";
properties.created = new Date("2014-12-13T22:02:00.000Z");
properties.identifier = "Original Identifier";
properties.keywords = "original; sample; keys";
properties.language = "Original Language";
properties.last_modified_by = "Original Editor";
properties.last_printed = new Date("2014-12-13T22:02:42.000Z");
properties.modified = new Date("2014-12-13T22:06:00.000Z");
properties.revision = 2;
properties.subject = "Original Subject";
properties.title = "Original Title";
properties.version = "Original Version";
const volume=Volume.fromJSON({"/saved":""}); await document.save({async write(bytes){volume.appendFileSync("/saved",bytes);}}); const fresh=await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer),textContext); const observed=fresh.core_properties;
expect(observed.author).toBe("Original Creator");
expect(observed.category).toBe("Original Category");
expect(observed.comments).toBe("Original Description");
expect(observed.content_status).toBe("Original Status");
expect(observed.created?.toISOString()).toBe("2014-12-13T22:02:00.000Z");
expect(observed.identifier).toBe("Original Identifier");
expect(observed.keywords).toBe("original; sample; keys");
expect(observed.language).toBe("Original Language");
expect(observed.last_modified_by).toBe("Original Editor");
expect(observed.last_printed?.toISOString()).toBe("2014-12-13T22:02:42.000Z");
expect(observed.modified?.toISOString()).toBe("2014-12-13T22:06:00.000Z");
expect(observed.revision).toBe(2);
expect(observed.subject).toBe("Original Subject");
expect(observed.title).toBe("Original Title");
expect(observed.version).toBe("Original Version");

});

it("workflow-056 observes original property collection variant", async () => {
 const document = await Document(undefined,{...textContext,timestamp:new Date("2026-09-15T00:00:00Z")});
 const properties=document.core_properties;
properties.author = "Original Creator";
properties.category = "Original Category";
properties.comments = "Original Description";
properties.content_status = "Original Status";
properties.created = new Date("2013-06-15T12:34:56.000Z");
properties.identifier = "Original Identifier";
properties.keywords = "original; sample; keys";
properties.language = "Original Language";
properties.last_modified_by = "Original Editor";
properties.last_printed = new Date("2013-06-15T12:34:56.000Z");
properties.modified = new Date("2013-06-15T12:34:56.000Z");
properties.revision = 9;
properties.subject = "Original Subject";
properties.title = "Original Title";
properties.version = "Original Version";
const observed=properties;
expect(observed.author).toBe("Original Creator");
expect(observed.category).toBe("Original Category");
expect(observed.comments).toBe("Original Description");
expect(observed.content_status).toBe("Original Status");
expect(observed.created?.toISOString()).toBe("2013-06-15T12:34:56.000Z");
expect(observed.identifier).toBe("Original Identifier");
expect(observed.keywords).toBe("original; sample; keys");
expect(observed.language).toBe("Original Language");
expect(observed.last_modified_by).toBe("Original Editor");
expect(observed.last_printed?.toISOString()).toBe("2013-06-15T12:34:56.000Z");
expect(observed.modified?.toISOString()).toBe("2013-06-15T12:34:56.000Z");
expect(observed.revision).toBe(9);
expect(observed.subject).toBe("Original Subject");
expect(observed.title).toBe("Original Title");
expect(observed.version).toBe("Original Version");

});

it("workflow-057 observes original property collection variant", async () => {
 const document = await Document(await textFixture("<w:p/>"),{...textContext,timestamp:new Date("2026-09-15T00:00:00Z")});
 const properties=document.core_properties; expect(properties).toBeInstanceOf(CoreProperties); expect(properties.revision).toBe(1); expect(properties.modified?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
});

it("workflow-066 observes original property collection variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{styles:{kind:"styles",xml:"<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:style w:type=\"paragraph\" w:styleId=\"Original0\"><w:name w:val=\"Original 0\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Original1\"><w:name w:val=\"Original 1\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Original2\"><w:name w:val=\"Original 2\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Original3\"><w:name w:val=\"Original 3\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Original4\"><w:name w:val=\"Original 4\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Original5\"><w:name w:val=\"Original 5\"/></w:style></w:styles>"}}),{...textContext,timestamp:new Date("2026-09-15T00:00:00Z")});
 const styles=document.styles; expect(styles.length).toBe(6); expect([...styles]).toHaveLength(6); for(const style of styles){expect(styles.at(style.name!).equals(style)).toBe(true); expect(styles.get_by_id(style.style_id,style.type)!.equals(style)).toBe(true);}
});

it("workflow-067 observes original property collection variant", async () => {
 const document = await Document(await textFixture("<w:p/>"),{...textContext,timestamp:new Date("2026-09-15T00:00:00Z")});
 const styles=document.styles; expect(styles.length).toBe(3); expect([...styles]).toHaveLength(3); for(const style of styles){expect(styles.at(style.name!).equals(style)).toBe(true); expect(styles.get_by_id(style.style_id,style.type)!.equals(style)).toBe(true);}
});
it("workflow-030 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const heading=document.add_heading("Original heading"); expect(heading.text).toBe("Original heading"); expect(heading.style!.name).toBe("Heading 1"); expect(document.paragraphs.at(-1)?.equals(heading)).toBe(true);
});

it("workflow-031 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const heading=document.add_heading("Original heading", 0); expect(heading.text).toBe("Original heading"); expect(heading.style!.name).toBe("Title"); expect(document.paragraphs.at(-1)?.equals(heading)).toBe(true);
});

it("workflow-032 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const heading=document.add_heading("Original heading", 1); expect(heading.text).toBe("Original heading"); expect(heading.style!.name).toBe("Heading 1"); expect(document.paragraphs.at(-1)?.equals(heading)).toBe(true);
});

it("workflow-033 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const heading=document.add_heading("Original heading", 2); expect(heading.text).toBe("Original heading"); expect(heading.style!.name).toBe("Heading 2"); expect(document.paragraphs.at(-1)?.equals(heading)).toBe(true);
});

it("workflow-034 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const heading=document.add_heading("Original heading", 5); expect(heading.text).toBe("Original heading"); expect(heading.style!.name).toBe("Heading 5"); expect(document.paragraphs.at(-1)?.equals(heading)).toBe(true);
});

it("workflow-035 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const heading=document.add_heading("Original heading", 9); expect(heading.text).toBe("Original heading"); expect(heading.style!.name).toBe("Heading 9"); expect(document.paragraphs.at(-1)?.equals(heading)).toBe(true);
});

it("workflow-036 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const paragraph=document.add_page_break(); expect(document.paragraphs.at(-1)).toBe(paragraph); expect(paragraph.runs).toHaveLength(1); expect(paragraph.runs[0]!.element.children.map(item=>item.localName)).toEqual(["br"]); expect([...paragraph.runs[0]!.element.children[0]!.attributes].find(([name])=>name.localName==="type")?.[1]).toBe("page");
});

it("workflow-045 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const first=document.sections.at(0); first.header.paragraphs[0]!.text="Original banner"; first.footer.paragraphs[0]!.text="Original footer"; const added=document.add_section(WD_SECTION_START.EVEN_PAGE); added.orientation=WD_ORIENT.LANDSCAPE; expect(document.sections.length).toBe(2); expect(document.sections.at(0).orientation).toEqual(WD_ORIENT.PORTRAIT); expect(added.orientation).toEqual(WD_ORIENT.LANDSCAPE);
});

it("workflow-046 observes shared document workflow variant", async () => {
 const document = await Document(undefined,textContext);
 const first=document.sections.at(0); first.header.paragraphs[0]!.text="Original banner"; first.footer.paragraphs[0]!.text="Original footer"; const added=document.add_section(); expect([added.header,added.footer,added.even_page_header,added.even_page_footer,added.first_page_header,added.first_page_footer].map(owner=>owner.is_linked_to_previous)).toEqual(Array(6).fill(true)); expect(added.header.paragraphs[0]!.text).toBe("Original banner"); expect(added.footer.paragraphs[0]!.text).toBe("Original footer");
});

it("workflow-058 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{settings:{kind:"settings",xml:"<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>"}}),textContext);
 expect(document.settings).toBeInstanceOf(Settings);
});

it("workflow-059 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>"),textContext);
 expect(document.settings).toBeInstanceOf(Settings);
});

it("workflow-060 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{settings:{kind:"settings",xml:"<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:evenAndOddHeaders/></w:settings>"}}),textContext);
 expect(document.settings.odd_and_even_pages_header_footer).toBe(true);
});

it("workflow-061 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{settings:{kind:"settings",xml:"<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"></w:settings>"}}),textContext);
 expect(document.settings.odd_and_even_pages_header_footer).toBe(false);
});

it("workflow-062 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{settings:{kind:"settings",xml:"<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:evenAndOddHeaders/></w:settings>"}}),textContext);
 document.settings.odd_and_even_pages_header_footer = true; expect(document.settings.odd_and_even_pages_header_footer).toBe(true);
});

it("workflow-063 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{settings:{kind:"settings",xml:"<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:evenAndOddHeaders/></w:settings>"}}),textContext);
 document.settings.odd_and_even_pages_header_footer = false; expect(document.settings.odd_and_even_pages_header_footer).toBe(false);
});

it("workflow-064 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{settings:{kind:"settings",xml:"<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"></w:settings>"}}),textContext);
 document.settings.odd_and_even_pages_header_footer = true; expect(document.settings.odd_and_even_pages_header_footer).toBe(true);
});

it("workflow-065 observes shared document workflow variant", async () => {
 const document = await Document(await textFixture("<w:p/>",{settings:{kind:"settings",xml:"<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"></w:settings>"}}),textContext);
 document.settings.odd_and_even_pages_header_footer = false; expect(document.settings.odd_and_even_pages_header_footer).toBe(false);
});
