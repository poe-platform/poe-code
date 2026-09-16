import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import * as sdk from "./index.js";

const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

async function blank() {
  return sdk.Presentation(
    await sdk.createPresentation({ slides: [{ name: "Garden study" }] }, context),
    context
  );
}
async function command(volume: Volume, args: string[]) {
  const result = await sdk
    .createPptxCommandEngine({ context, maxArgumentBytes: 100000, maxOutputBytes: 1000000 })
    .execute({
      args: [...args, "--json"].map((value) => new TextEncoder().encode(value)),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
      publishOutput: async (output) => {
        if (!output.dryRun) volume.writeFileSync(output.outputPath, output.bytes);
      }
    });
  const body = JSON.parse(new TextDecoder().decode(result.stdout));
  expect(result.exitCode, JSON.stringify(body)).toBe(0);
  return body;
}

it("opens original bytes and explicit streams and saves through a memory publication capability", async () => {
  const volume = Volume.fromJSON({});
  const deck = await sdk.Presentation(undefined, context);
  deck.core_properties.title = "Seed inventory";
  const chunks: Uint8Array[] = [];
  await deck.save({
    write: async (bytes) => {
      chunks.push(new Uint8Array(bytes));
    },
    close: async () => {}
  });
  const bytes = new Uint8Array(Buffer.concat(chunks));
  let offset = 0;
  const reopened = await sdk.Presentation(
    {
      read: async (maximum) => {
        if (offset === bytes.length) return null;
        const chunk = bytes.slice(offset, offset + maximum);
        offset += chunk.length;
        return chunk;
      }
    },
    context
  );
  expect(reopened.core_properties.title).toBe("Seed inventory");
  await reopened.save({
    outputPath: "/seed.pptx",
    publishOutput: async (output) => {
      volume.writeFileSync(output.outputPath, output.bytes);
    }
  });
  expect(
    (await sdk.Presentation(new Uint8Array(volume.readFileSync("/seed.pptx") as Buffer), context))
      .slides.length
  ).toBe(0);
  await command(volume, ["inspect", "/seed.pptx"]);
});

it("authors a title and nested paragraphs from a named original layout with sparse placeholders", async () => {
  const bytes = await sdk.createPresentation({}, context);
  const layout = await sdk.addLayout(
    bytes,
    {
      scope: "layouts",
      master: "Original master",
      name: "Field card",
      placeholders: [
        { type: "title", index: 0, name: "Caption", x: 0, y: 0, width: 4000000, height: 800000 },
        {
          type: "body",
          index: 9,
          name: "Observations",
          x: 0,
          y: 900000,
          width: 4000000,
          height: 2000000
        }
      ]
    },
    context
  );
  const deck = await sdk.Presentation(layout.bytes, context);
  const slide = deck.slides.add_slide(deck.slide_layouts.get_by_name("Field card")!);
  slide.shapes.title!.text = "Garden census";
  expect(slide.shapes.title!.text).toBe("Garden census");
  const body = slide.placeholders.get(9);
  expect(body.is_placeholder).toBe(true);
  expect(body.placeholder_format.idx).toBe(9);
  expect(body.width!.emu).toBe(4000000);
  expect(() => slide.placeholders.get(1)).toThrow();
  body.text_frame.text = "Plants";
  for (const [level, text] of [
    [1, "Herbs"],
    [2, "Basil"]
  ] as const) {
    const paragraph = body.text_frame.add_paragraph();
    paragraph.text = text;
    paragraph.level = level;
  }
  const saved = await sdk.Presentation(await deck.save(), context);
  expect(saved.slides[0]!.placeholders.get(9).text).toBe("Plants\nHerbs\nBasil");
  expect(saved.slides[0]!.placeholders.get(9).text_frame.paragraphs.map((p) => p.level)).toEqual([
    0, 1, 2
  ]);
});

it("formats textbox paragraphs and runs and extracts only text-bearing slide shapes", async () => {
  const deck = await blank(),
    shapes = deck.slides[0]!.shapes;
  const box = shapes.add_textbox(
    new sdk.Inches(1),
    new sdk.Inches(1),
    new sdk.Inches(4),
    new sdk.Inches(2)
  );
  const frame = box.text_frame;
  frame.clear();
  frame.margin_left = new sdk.Inches(0.2);
  frame.word_wrap = true;
  frame.vertical_anchor = sdk.MSO_ANCHOR.MIDDLE;
  frame.auto_size = sdk.MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT;
  const paragraph = frame.paragraphs[0]!;
  paragraph.alignment = sdk.PP_ALIGN.RIGHT;
  paragraph.space_before = new sdk.Pt(6);
  paragraph.space_after = new sdk.Pt(9);
  const run = paragraph.add_run();
  run.text = "Watering schedule";
  run.font.name = "Arial";
  run.font.size = new sdk.Pt(18);
  run.font.bold = true;
  run.font.italic = null;
  expect(run.font.italic).toBeNull();
  run.font.color.theme_color = sdk.MSO_THEME_COLOR.ACCENT_3;
  expect(run.font.color.theme_color).toBe(sdk.MSO_THEME_COLOR.ACCENT_3);
  run.font.color.rgb = new sdk.RGBColor(20, 80, 110);
  run.hyperlink.address = "https://example.invalid/garden";
  const second = frame.add_paragraph();
  second.text = "Morning";
  second.font.size = new sdk.Pt(28);
  const reopened = await sdk.Presentation(await deck.save(), context);
  const texts = [...reopened.slides].flatMap((slide) =>
    [...slide.shapes]
      .filter((shape): shape is sdk.Shape => shape instanceof sdk.Shape && shape.has_text_frame)
      .flatMap((shape) => shape.text_frame.paragraphs.flatMap((p) => p.runs.map((r) => r.text)))
  );
  expect(texts).toEqual(["Watering schedule", "Morning"]);
  const read = (reopened.slides[0]!.shapes[0] as sdk.Shape).text_frame;
  expect(read.paragraphs[0]!.runs[0]!.font.color.rgb).toEqual(new sdk.RGBColor(20, 80, 110));
  expect(read.paragraphs[0]!.runs[0]!.font.size!.pt).toBe(18);
  expect(read.paragraphs[0]!.runs[0]!.hyperlink.address).toBe("https://example.invalid/garden");
});

it("formats preset geometry, themed fills, lines and callout adjustments with explicit units", async () => {
  const deck = await blank(),
    shapes = deck.slides[0]!.shapes;
  const shape = shapes.add_shape(
    sdk.MSO_SHAPE.ROUNDED_RECTANGLE,
    new sdk.Inches(1),
    new sdk.Inches(1),
    new sdk.Inches(2),
    new sdk.Inches(1)
  );
  expect(new sdk.Pt(72).emu).toBe(new sdk.Inches(1).emu);
  shape.left = new sdk.Inches(2);
  shape.fill.solid();
  shape.fill.fore_color.rgb = new sdk.RGBColor(22, 88, 44);
  shape.fill.fore_color.theme_color = sdk.MSO_THEME_COLOR.ACCENT_2;
  shape.fill.fore_color.brightness = -0.2;
  shape.line.color.theme_color = sdk.MSO_THEME_COLOR.ACCENT_4;
  shape.line.width = new sdk.Pt(2);
  expect(shape.line.width.pt).toBe(2);
  shape.line.fill.background();
  expect(shape.line.fill.type).toBe(5);
  shape.fill.background();
  expect(() => shape.fill.fore_color).toThrow();
  const callout = shapes.add_shape(
    sdk.MSO_SHAPE.LINE_CALLOUT_2_ACCENT_BAR,
    new sdk.Inches(0),
    new sdk.Inches(0),
    new sdk.Inches(2),
    new sdk.Inches(1)
  );
  for (const [index, value] of [0.4, 0, 0.4, -0.2, 2, -1].entries())
    callout.adjustments[index] = value;
  callout.rotation = -30;
  const reopened = await sdk.Presentation(await deck.save(), context);
  expect((reopened.slides[0]!.shapes[1] as sdk.Shape).adjustments[3]).toBe(-0.2);
  expect(reopened.slides[0]!.shapes[1]!.rotation).toBe(330);
});

it("merges and splits cells while retaining row-major text and reporting visible grid coordinates", async () => {
  const deck = await blank();
  const table = deck.slides[0]!.shapes.add_table(
    2,
    3,
    new sdk.Inches(1),
    new sdk.Inches(1),
    new sdk.Inches(6),
    new sdk.Inches(2)
  ).table;
  table.columns[0]!.width = new sdk.Inches(1);
  for (const [index, cell] of [...table.iter_cells()].entries()) cell.text = `Plant ${index}`;
  table.cell(0, 0).merge(table.cell(1, 1));
  expect(table.cell(0, 0).text).toBe("Plant 0\nPlant 1\nPlant 3\nPlant 4");
  expect([...table.iter_cells()].filter((cell) => !cell.is_spanned)).toHaveLength(3);
  const origins = [...table.rows].flatMap((row, rowIndex) =>
    [...row.cells].flatMap((cell, columnIndex) =>
      cell.is_merge_origin
        ? [{ rowIndex, columnIndex, width: cell.span_width, height: cell.span_height }]
        : []
    )
  );
  expect(origins).toEqual([{ rowIndex: 0, columnIndex: 0, width: 2, height: 2 }]);
  table.cell(0, 0).split();
  expect([...table.iter_cells()].some((cell) => cell.is_merge_origin)).toBe(false);
  expect(table.cell(0, 1).text).toBe("");
  const reopened = await sdk.Presentation(await deck.save(), context);
  expect((reopened.slides[0]!.shapes[0] as sdk.GraphicFrame).table.cell(0, 0).text).toContain(
    "Plant 4"
  );
});

it.each([sdk.XL_CHART_TYPE.COLUMN_CLUSTERED, sdk.XL_CHART_TYPE.LINE, sdk.XL_CHART_TYPE.PIE])(
  "authors category chart %s with guide axis, labels and legend formatting",
  async (type) => {
    const deck = await blank();
    const data = new sdk.CategoryChartData();
    data.categories = ["Fern", "Moss", "Sedge"];
    data.add_series("Observed", [7, 4, 9]);
    const chart = deck.slides[0]!.shapes.add_chart(
      type,
      new sdk.Inches(1),
      new sdk.Inches(1),
      new sdk.Inches(6),
      new sdk.Inches(4),
      data
    ).chart;
    chart.has_legend = true;
    if (type === sdk.XL_CHART_TYPE.LINE) {
      const series = chart.series[0] as sdk.chart.LineSeries;
      series.smooth = true;
      expect(series.smooth).toBe(true);
    }
    chart.legend!.position = sdk.XL_LEGEND_POSITION.BOTTOM;
    chart.legend!.include_in_layout = false;
    const plot = chart.plots[0]!;
    plot.has_data_labels = true;
    plot.data_labels.font.size = new sdk.Pt(12);
    plot.data_labels.font.color.rgb = new sdk.RGBColor(40, 60, 90);
    plot.data_labels.position = sdk.XL_LABEL_POSITION.OUTSIDE_END;
    plot.data_labels.number_format = "0%";
    if (type !== sdk.XL_CHART_TYPE.PIE) {
      chart.category_axis.has_major_gridlines = true;
      chart.category_axis.minor_tick_mark = sdk.XL_TICK_MARK.OUTSIDE;
      chart.category_axis.tick_labels.font.italic = true;
      chart.value_axis.maximum_scale = 20;
      chart.value_axis.has_minor_gridlines = true;
      chart.value_axis.tick_labels.number_format = "0.0";
    }
    const read = (await sdk.Presentation(await deck.save(), context)).slides[0]!
      .shapes[0] as sdk.GraphicFrame;
    expect(read.chart.series[0]!.values).toEqual([7, 4, 9]);
    expect(read.chart.legend!.include_in_layout).toBe(false);
    expect(read.chart.plots[0]!.data_labels.number_format).toBe("0%");
  }
);

it("authors independent XY and bubble series through public builders", async () => {
  const deck = await blank();
  const xy = new sdk.XyChartData(),
    bubble = new sdk.BubbleChartData();
  xy.add_series("Moisture").add_data_point(1.25, 8);
  xy.add_series("Shade").add_data_point(2.5, 6);
  bubble.add_series("Canopy").add_data_point(3.5, 5, 12);
  for (const [type, data] of [
    [sdk.XL_CHART_TYPE.XY_SCATTER, xy],
    [sdk.XL_CHART_TYPE.BUBBLE, bubble]
  ] as const) {
    deck.slides[0]!.shapes.add_chart(
      type,
      new sdk.Inches(0),
      new sdk.Inches(0),
      new sdk.Inches(4),
      new sdk.Inches(3),
      data
    );
  }
  const reopened = await sdk.Presentation(await deck.save(), context);
  expect(
    [...reopened.slides[0]!.shapes].map((shape) => (shape as sdk.GraphicFrame).chart.chart_type)
  ).toEqual([sdk.XL_CHART_TYPE.XY_SCATTER, sdk.XL_CHART_TYPE.BUBBLE]);
});

it("runs SDK-backed command creation, replacement, table merge and speaker-note workflows in memory", async () => {
  const volume = Volume.fromJSON({});
  await command(volume, [
    "create",
    "--slides-json",
    JSON.stringify([
      {
        name: "Garden",
        shapes: [
          { name: "Heading", x: 0, y: 0, width: 2000000, height: 800000, text: "Draft report" }
        ]
      }
    ]),
    "--output",
    "/garden.pptx"
  ]);
  await command(volume, [
    "text",
    "replace",
    "/garden.pptx",
    "--find",
    "Draft",
    "--with",
    "Final",
    "--all",
    "--slide",
    "1",
    "--in-place"
  ]);
  await command(volume, [
    "tables",
    "add",
    "/garden.pptx",
    "--slide",
    "1",
    "--rows",
    "2",
    "--columns",
    "2",
    "--left",
    "1in",
    "--top",
    "2in",
    "--width",
    "4in",
    "--height",
    "1in",
    "--data",
    '[["Soil","Sun"],["Wet","Bright"]]',
    "--in-place"
  ]);
  await command(volume, [
    "tables",
    "merge",
    "/garden.pptx",
    "--slide",
    "1",
    "--table",
    "1",
    "--from",
    "1,1",
    "--to",
    "2,2",
    "--in-place"
  ]);
  await command(volume, [
    "notes",
    "add",
    "/garden.pptx",
    "--slide",
    "1",
    "--text",
    "Review the irrigation figures",
    "--in-place"
  ]);
  const bytes = new Uint8Array(volume.readFileSync("/garden.pptx") as Buffer);
  expect(((await sdk.Presentation(bytes, context)).slides[0]!.shapes[0] as sdk.Shape).text).toBe(
    "Final report"
  );
  expect((await sdk.readNotes(bytes, {}, context))[0]!.text).toBe("Review the irrigation figures");
  await command(volume, ["schema", "tables", "merge"]);
  await command(volume, ["capabilities"]);
});

it("inserts explicitly supplied pictures and replaces rich-content placeholders without retaining old handles", async () => {
  const pixels = new Uint8Array(62),
    header = new DataView(pixels.buffer);
  pixels.set([66, 77]);
  header.setUint32(2, 62, true);
  header.setUint32(10, 54, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, 1, true);
  header.setInt32(22, 2, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 24, true);
  pixels.set([20, 40, 60, 0, 80, 100, 120, 0], 54);
  const layout = await sdk.addLayout(
    await sdk.createPresentation({}, context),
    {
      scope: "layouts",
      master: "Original master",
      name: "Specimen slots",
      placeholders: ["pic", "tbl", "chart"].map((type, index) => ({
        type,
        index: index + 12,
        name: `Slot ${index}`,
        x: index * 2000000,
        y: 1000000,
        width: 1800000,
        height: 1800000
      }))
    },
    context
  );
  const deck = await sdk.Presentation(layout.bytes, context);
  const slide = deck.slides.add_slide(deck.slide_layouts.get_by_name("Specimen slots")!);
  const original = slide.placeholders.get(12) as sdk.SlidePlaceholder;
  const picture = await original.insert_picture(pixels);
  expect(picture.placeholder_format.idx).toBe(12);
  expect(() => original.name).toThrow();
  const table = (slide.placeholders.get(13) as sdk.SlidePlaceholder).insert_table(2, 2).table;
  table.cell(1, 1).text = "Sprout";
  const data = new sdk.CategoryChartData();
  data.categories = ["Week"];
  data.add_series("Height", [3]);
  const chart = (slide.placeholders.get(14) as sdk.SlidePlaceholder).insert_chart(
    sdk.XL_CHART_TYPE.LINE,
    data
  ).chart;
  expect(chart.series[0]!.values).toEqual([3]);
  const native = await slide.shapes.add_picture(pixels, new sdk.Inches(1), new sdk.Inches(0));
  const scaled = await slide.shapes.add_picture(
    pixels,
    new sdk.Inches(2),
    new sdk.Inches(0),
    null,
    new sdk.Inches(2)
  );
  expect(scaled.width!.inches).toBe(1);
  expect(native.image.size).toEqual([1, 2]);
  const reopened = await sdk.Presentation(await deck.save(), context);
  expect((reopened.slides[0]!.placeholders.get(13) as sdk.GraphicFrame).table.cell(1, 1).text).toBe(
    "Sprout"
  );
  expect(reopened.slides[0]!.shapes.length).toBe(5);
});
