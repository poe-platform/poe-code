import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { addChart, setCharts } from "./chart-editing.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { readCharts } from "./charts.js";

const context = {
  limits: { maxBytes: 524288, maxReads: 1000, chunkBytes: 8192 },
  archiveLimits: {
    maxArchiveBytes: 524288,
    maxEntryBytes: 131072,
    maxTotalBytes: 524288,
    maxMembers: 128,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 131072,
    chunkSize: 8192
  },
  xmlLimits: { maxBytes: 131072, maxNodes: 8000, maxDepth: 64 },
  relationshipLimits: { maxBytes: 131072, maxParts: 128, maxRelationships: 128 }
};
const data = { categories: ["First", "Last"], series: [{ name: "Count", values: [1, null] }] };
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function seed() {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/seed.pptx", await createPresentation({ slides: [{}] }, context));
  return addChart(
    new Uint8Array(volume.readFileSync("/seed.pptx") as Buffer),
    {
      slide: 1,
      type: "COLUMN_CLUSTERED",
      data,
      left: 0,
      top: 0,
      width: 914400,
      height: 914400,
      legend: true
    },
    context
  );
}
function chartBytes(bytes: Uint8Array) {
  return inspectZip(bytes).find((e) => e.name === "ppt/charts/chart1.xml")!.payload;
}
function patchChart(bytes: Uint8Array, change: (xml: string) => string) {
  return writePackageArchive(
    inspectZip(bytes).map((e) => ({
      name: e.name,
      bytes: e.name === "ppt/charts/chart1.xml" ? encode(change(decode(e.payload))) : e.payload
    })),
    context,
    { compression: "store" }
  );
}
it.each(["external formula", "worksheet formula", "external workbook"])(
  "preserves %s dependencies during SDK and CLI styling and rejects data publication",
  async (dependency) => {
    let source = await seed();
    if (dependency === "external formula")
      source = await patchChart(source, (xml) =>
        xml.replace("Sheet1!$B$2:$B$3", "'[remote.xlsx]Sheet1'!$B$2:$B$3")
      );
    else {
      const parts = inspectZip(source);
      if (dependency === "worksheet formula") {
        const book = parts.find((entry) => entry.name.endsWith(".xlsx"))!;
        book.payload = new Uint8Array(
          await writePackageArchive(
            [
              ...inspectZip(book.payload).map((entry) => ({
                name: entry.name,
                bytes:
                  entry.name === "xl/worksheets/sheet1.xml"
                    ? encode(
                        decode(entry.payload).replace(
                          '<c r="B2"><v>1</v>',
                          '<c r="B2"><f>2-1</f><v>1</v>'
                        )
                      )
                    : entry.name === "[Content_Types].xml"
                      ? encode(
                          decode(entry.payload).replace(
                            "</Types>",
                            '<Default Extension="bin" ContentType="application/octet-stream"/></Types>'
                          )
                        )
                      : entry.payload
              })),
              { name: "custom/preserved.bin", bytes: new Uint8Array([0, 255, 3, 128, 42]) }
            ],
            context,
            { compression: "store" }
          )
        );
        expect(
          decode(
            inspectZip(book.payload).find((entry) => entry.name === "xl/worksheets/sheet1.xml")!
              .payload
          )
        ).toContain("<f>2-1</f><v>1</v>");
      } else {
        const links = parts.find((entry) => entry.name === "ppt/charts/_rels/chart1.xml.rels")!;
        links.payload = encode(
          decode(links.payload).replace(
            'Target="../embeddings/chart1.xlsx"',
            'Target="https://data.invalid/chart.xlsx" TargetMode="External"'
          )
        );
      }
      source = await writePackageArchive(
        parts.map((entry) => ({ name: entry.name, bytes: entry.payload })),
        context,
        { compression: "store" }
      );
    }
    const initial = source.slice();
    const inventory = await readCharts(source, { slide: 1 }, context);
    expect(inventory).toHaveLength(1);
    expect(inventory[0]!.links).toContainEqual(
      expect.objectContaining({
        role: "workbook",
        authoritative: true,
        external: dependency === "external workbook",
        targetPart: dependency === "external workbook" ? null : "/ppt/embeddings/chart1.xlsx"
      })
    );
    expect(inventory[0]!.plots[0]!.series[0]!.values).toMatchObject({
      authority: "referenced",
      formula:
        dependency === "external formula" ? "'[remote.xlsx]Sheet1'!$B$2:$B$3" : "Sheet1!$B$2:$B$3",
      points: [{ index: "0", value: "1" }]
    });
    const volume = Volume.fromJSON({
      "/input.pptx": Buffer.from(source),
      "/output.pptx": "retain destination"
    });
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 16384,
      maxOutputBytes: 524288
    });
    const publish = vi.fn(
      async (output: { outputPath: string; bytes: Uint8Array; dryRun: boolean }) => {
        if (!output.dryRun) volume.writeFileSync(output.outputPath, output.bytes);
      }
    );
    const invoke = (flags: string[]) =>
      engine.execute({
        args: ["charts", "set", "/input.pptx", "--slide", "1", ...flags, "--json"].map(encode),
        signal: new AbortController().signal,
        readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
        publishOutput: publish
      });
    await expect(setCharts(source, { slide: 1 }, { data }, context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
    for (const flags of [["--output", "/output.pptx", "--force"], ["--dry-run"]]) {
      const result = await invoke(["--data", JSON.stringify(data), ...flags]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(decode(result.stdout))).toMatchObject({
        ok: false,
        data: null,
        affected: 0,
        errors: [expect.objectContaining({ code: "unsupported-edit" })]
      });
    }
    expect(publish).not.toHaveBeenCalled();
    expect(volume.readFileSync("/output.pptx", "utf8")).toBe("retain destination");
    const sdk = await setCharts(source, { slide: 1 }, { style: 7 }, context);
    const styled = await invoke(["--style", "7", "--output", "/output.pptx", "--force"]);
    expect(styled.exitCode).toBe(0);
    expect(JSON.parse(decode(styled.stdout))).toMatchObject({
      version: 1,
      operation: "charts.set",
      ok: true,
      affected: 1,
      errors: []
    });
    for (const output of [sdk, new Uint8Array(volume.readFileSync("/output.pptx") as Buffer)]) {
      const parts = inspectZip(output);
      expect(parts.map((entry) => entry.name).sort()).toEqual(
        inspectZip(source)
          .map((entry) => entry.name)
          .sort()
      );
      for (const original of inspectZip(source)) {
        const actual = parts.find((entry) => entry.name === original.name)!.payload;
        if (original.name === "ppt/charts/chart1.xml")
          expect(decode(actual)).toBe(
            decode(original.payload).replace(
              "<c:chart>",
              '<c:style xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" val="7"/><c:chart>'
            )
          );
        else expect(actual).toEqual(original.payload);
      }
    }
    expect(source).toEqual(initial);
    expect(new Uint8Array(volume.readFileSync("/input.pptx") as Buffer)).toEqual(initial);
  }
);
it("rejects formula expressions instead of silently replacing their authority", async () => {
  const source = await patchChart(await seed(), (xml) =>
    xml.replace("Sheet1!$B$2:$B$3", "SUM(Sheet1!$B$2:$B$3)")
  );
  await expect(setCharts(source, { slide: 1 }, { data }, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
it("expands simple series with independent labels and synchronized cells", async () => {
  const bytes = await setCharts(
    await seed(),
    { slide: 1 },
    {
      data: {
        categories: ["Only"],
        series: [
          { name: "A", values: [2] },
          { name: "B", values: [4] }
        ]
      }
    },
    context
  );
  const xml = decode(chartBytes(bytes));
  expect(xml).toContain('<c:idx val="1"/><c:order val="1"/>');
  expect(xml).toContain("<c:f>Sheet1!$C$2:$C$2</c:f>");
  const book = inspectZip(bytes).find((e) => e.name.endsWith(".xlsx"))!;
  expect(
    decode(inspectZip(book.payload).find((e) => e.name === "xl/worksheets/sheet1.xml")!.payload)
  ).toContain('<c r="C2"><v>4</v></c>');
});
it("refuses shadowed fallback style edits without changing unknown choices", async () => {
  const source = await patchChart(await seed(), (xml) =>
    xml.replace(
      "<c:chart>",
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:unknown-chart-style"><mc:Choice Requires="u"><u:style val="110"/></mc:Choice><mc:Fallback><c:style val="2"/></mc:Fallback></mc:AlternateContent><c:chart>'
    )
  );
  await expect(setCharts(source, { slide: 1 }, { style: 7 }, context)).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});
it("enabling an existing legend preserves custom placement and formatting", async () => {
  const source = await patchChart(await seed(), (xml) =>
    xml
      .replace('<c:legendPos val="r"/>', '<c:legendPos val="b"/>')
      .replace(
        '<c:overlay val="0"/></c:legend>',
        '<c:overlay val="1"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1500"/></a:pPr></a:p></c:txPr></c:legend>'
      )
  );
  const changed = await setCharts(source, { slide: 1 }, { legend: true }, context);
  expect(chartBytes(changed)).toEqual(chartBytes(source));
});
it.each(["sdk", "cli"])("%s title edits preserve title layout and formatting", async (surface) => {
  const retained =
    '<c:layout><c:manualLayout><c:x val="0.2"/><c:y val="0.1"/></c:manualLayout></c:layout><c:overlay val="1"/><c:spPr><a:solidFill><a:srgbClr val="246810"/></a:solidFill></c:spPr><c:txPr><a:bodyPr rot="600000"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p></c:txPr>';
  const source = await patchChart(await seed(), (xml) =>
    xml.replace(
      '<c:autoTitleDeleted val="1"/>',
      `<c:title><c:tx><c:rich><a:bodyPr wrap="none"/><a:lstStyle><a:lvl1pPr marL="1200"/></a:lstStyle><a:p><a:r><a:t>Old heading</a:t></a:r></a:p></c:rich></c:tx>${retained}</c:title><c:autoTitleDeleted val="0"/>`
    )
  );
  let changed: Uint8Array;
  if (surface === "sdk")
    changed = await setCharts(source, { slide: 1 }, { title: "New & clear" }, context);
  else {
    const volume = Volume.fromJSON({ "/input.pptx": Buffer.from(source) });
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 16384,
      maxOutputBytes: 524288
    });
    const result = await engine.execute({
      args: [
        "charts",
        "set",
        "/input.pptx",
        "--slide",
        "1",
        "--title",
        "New & clear",
        "--output",
        "/output.pptx",
        "--json"
      ].map(encode),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
      publishOutput: async (output) => {
        volume.writeFileSync(output.outputPath, output.bytes);
      }
    });
    expect(result.exitCode).toBe(0);
    changed = new Uint8Array(volume.readFileSync("/output.pptx") as Buffer);
  }
  const xml = decode(chartBytes(changed));
  expect(xml).toContain(retained);
  expect(xml).toContain("New &amp; clear</");
  expect(xml).toContain('<a:bodyPr wrap="none"/>');
  expect(xml).toContain('<a:lstStyle><a:lvl1pPr marL="1200"/></a:lstStyle>');
  expect(xml).not.toContain("Old heading");
  for (const part of inspectZip(source).filter((entry) => entry.name !== "ppt/charts/chart1.xml")) {
    expect(inspectZip(changed).find((entry) => entry.name === part.name)!.payload).toEqual(
      part.payload
    );
  }
});
it.each([
  ["missing text", ""],
  ["empty text", "<c:tx/>"],
  [
    "referenced text",
    '<c:tx><c:strRef><c:f>Sheet1!$A$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Old</c:v></c:pt></c:strCache></c:strRef></c:tx>'
  ],
  [
    "literal text",
    "<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Old</a:t></a:r></a:p></c:rich></c:tx>"
  ]
])("assigns an empty title with %s while retaining its layout", async (_name, text) => {
  const source = await patchChart(await seed(), (xml) =>
    xml.replace(
      '<c:autoTitleDeleted val="1"/>',
      `<c:title>${text}<c:layout/><c:overlay val="1"/></c:title><c:autoTitleDeleted val="0"/>`
    )
  );
  const changed = await setCharts(source, { slide: 1 }, { title: "" }, context);
  const xml = decode(chartBytes(changed));
  expect(xml).toContain('</c:tx><c:layout/><c:overlay val="1"/></c:title>');
  expect(xml).not.toContain("Old");
  expect(xml).not.toContain("Sheet1!$A$1");
});
it("rewrites only chart data and its workbook while preserving theme dependencies", async () => {
  const source = await seed();
  const changed = await setCharts(
    source,
    { slide: 1 },
    { data: { categories: ["Second", "First"], series: [{ name: "New", values: [null, 0] }] } },
    context
  );
  const entries = inspectZip(changed);
  for (const old of inspectZip(source).filter(
    (e) => e.name !== "ppt/charts/chart1.xml" && !e.name.endsWith(".xlsx")
  )) {
    expect(entries.find((e) => e.name === old.name)!.payload).toEqual(old.payload);
  }
  expect(decode(chartBytes(changed))).toContain(
    '<c:ptCount val="2"/><c:pt idx="1"><c:v>0</c:v></c:pt>'
  );
});
it("retains distinct series and point styling, labels and axis bounds during data replacement", async () => {
  const original = await addChart(
    await createPresentation({ slides: [{}] }, context),
    {
      slide: 1,
      type: "COLUMN_CLUSTERED",
      left: 0,
      top: 0,
      width: 914400,
      height: 914400,
      data: {
        categories: ["Low", "High"],
        series: [
          { name: "Rate", values: [0.1, 0.2], numberFormat: "0.0%" },
          { name: "Amount", values: [10, 20], numberFormat: "0.00" }
        ]
      }
    },
    context
  );
  const firstStyle =
    '<c:spPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill></c:spPr><c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></c:spPr></c:dPt><c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:showVal val="1"/></c:dLbls>';
  const secondStyle =
    '<c:spPr><a:solidFill><a:srgbClr val="654321"/></a:solidFill></c:spPr><c:dLbls><c:numFmt formatCode="0.00" sourceLinked="0"/><c:showVal val="0"/></c:dLbls>';
  const source = await patchChart(original, (xml) =>
    xml
      .replace("</c:tx><c:cat>", `</c:tx>${firstStyle}<c:cat>`)
      .replace("</c:tx><c:cat>", `</c:tx>${secondStyle}<c:cat>`)
      .replace(
        '<c:orientation val="minMax"/>',
        '<c:orientation val="minMax"/><c:max val="40"/><c:min val="-5"/>'
      )
  );
  const result = await setCharts(
    source,
    { slide: 1 },
    {
      data: {
        categories: ["New", "Last"],
        series: [
          { name: "Ratio", values: [null, 0], numberFormat: "0.00%" },
          { name: "Total", values: [12, -3], numberFormat: "#,##0" }
        ]
      }
    },
    context
  );
  const xml = decode(chartBytes(result));
  expect(xml).toContain(firstStyle);
  expect(xml).toContain(secondStyle);
  expect(xml).toContain('<c:orientation val="minMax"/><c:max val="40"/><c:min val="-5"/>');
  expect(xml).toContain(
    '<c:formatCode>0.00%</c:formatCode><c:ptCount val="2"/><c:pt idx="1"><c:v>0</c:v></c:pt>'
  );
  expect(xml).toContain(
    '<c:formatCode>#,##0</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>-3</c:v></c:pt>'
  );
});

it.each([
  ["mixed plots", "</c:barChart>", '<c:lineChart><c:grouping val="standard"/></c:lineChart>'],
  ["trendlines", "</c:ser>", '<c:trendline><c:trendlineType val="linear"/></c:trendline>'],
  [
    "error bars",
    "</c:ser>",
    '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="fixedVal"/><c:val val="1"/></c:errBars>'
  ],
  ["extensions", "</c:ser>", '<c:extLst><c:ext uri="urn:original:chart-data"/></c:extLst>']
])(
  "rejects data edits with %s while permitting a local title edit",
  async (_name, anchor, addition) => {
    const source = await patchChart(await seed(), (xml) =>
      xml.replace(anchor!, anchor === "</c:barChart>" ? anchor + addition : addition + anchor)
    );
    await expect(setCharts(source, { slide: 1 }, { data }, context)).rejects.toMatchObject({
      code: "unsupported-edit"
    });
    const changed = await setCharts(source, { slide: 1 }, { title: "Local title" }, context);
    expect(decode(chartBytes(changed))).toContain(addition);
  }
);

it.each([
  ["XY_SCATTER_SMOOTH", '<c:marker><c:symbol val="circle"/></c:marker>', '<c:smooth val="1"/>'],
  ["LINE_MARKERS", '<c:marker><c:symbol val="circle"/></c:marker>', '<c:smooth val="0"/>']
] as const)("new series retain the existing %s variant", async (type, marker, smooth) => {
  const scatter = type === "XY_SCATTER_SMOOTH";
  const d = scatter
    ? { series: [{ name: "A", xValues: [3], values: [5] }] }
    : { categories: ["A"], series: [{ name: "A", values: [5] }] };
  const source = await addChart(
    await createPresentation({ slides: [{}] }, context),
    { slide: 1, type, data: d, left: 0, top: 0, width: 914400, height: 914400 },
    context
  );
  const changed = await setCharts(
    source,
    { slide: 1 },
    { data: { ...d, series: [...d.series, { ...d.series[0]!, name: "B" }] } },
    context
  );
  const xml = decode(chartBytes(changed));
  const second = xml.slice(xml.indexOf('<c:idx val="1"/>'), xml.lastIndexOf("</c:ser>"));
  expect(second).toContain(marker);
  expect(second).toContain(smooth);
});
