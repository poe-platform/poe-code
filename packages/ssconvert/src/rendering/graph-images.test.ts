import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createResourceIO, runCommand } from "../index.js";
import { readGnumeric } from "../codecs/gnumeric.js";

const graph = (name: string, offsets = "0 0 71 35") => `<g:SheetObjectGraph Name="${name}" AnchorMode="2" ObjectBound="A1:A1" ObjectOffset="${offsets}"><GogObject type="GogGraph"/></g:SheetObjectGraph>`;
const sheet = (name: string, objects: string) => `<g:Sheet><g:Name>${name}</g:Name><g:Objects>${objects}</g:Objects><g:Cells/></g:Sheet>`;
const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${sheet("One", graph("First") + graph("Last") + graph("Top", "10 -10 71 35"))}${sheet("Two", graph("Later"))}</g:Sheets></g:Workbook>`;
function fixture() {
  const volume = Volume.fromJSON({ "/original": source });
  const engine = createEngine({
    codecs: [{ id: "original", description: "Original in-memory graph fixture", extensions: [], probeContent: () => true,
      async read(bytes, context) { return readGnumeric(bytes, context); } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 100000, cells: 100, sheets: 10, operations: 100, workbookWork: 100000 },
    filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { volume.writeFileSync(path, bytes); }
    } })
  });
  const stderr: string[] = [];
  const stdout: string[] = [];
  const operation = { signal: new AbortController().signal,
    stdout: { async write(bytes: Uint8Array) { stdout.push(new TextDecoder().decode(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(new TextDecoder().decode(bytes)); } } };
  return { engine, volume, stderr, stdout, operation };
}
it("matches captured unknown-target status, tie ordering, empty files and stop after failed sheet", async () => {
  const f = fixture();
  expect(await runCommand(["--export-graphs", "-T", "unknown", "/original", "/bad-%n-%o.bin"], f.engine, f.operation)).toMatchObject({ exitCode: 1 });
  expect(f.stdout).toEqual([]);
  expect(f.stderr).toEqual([
    "Failed to write file:///bad-0-Top.bin: Unknown image format\n",
    "Failed to write file:///bad-1-Last.bin: Unknown image format\n",
    "Failed to write file:///bad-2-First.bin: Unknown image format\n"
  ]);
  expect(f.volume.toJSON()).toEqual({ "/original": source, "/bad-0-Top.bin": "", "/bad-1-Last.bin": "", "/bad-2-First.bin": "" });
});
it("exports genuinely empty native graphs as SVG, preserving dimensions and global indices", async () => {
  const f = fixture();
  expect(await runCommand(["--export-graphs", "/original", "/graph-%n-%o.svg"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(f.stderr).toEqual([]);
  const expected = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="71" height="35" viewBox="0 0 71 35">\n</svg>\n';
  for (const [index, name] of ["Top", "Last", "First", "Later"].entries())
    expect(f.volume.readFileSync(`/graph-${index}-${name}.svg`, "utf8")).toBe(expected);
});
it("does not open an image output when there are no graphs", async () => {
  const f = fixture();
  f.volume.writeFileSync("/original", `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${sheet("Empty", '<g:SheetObjectImage/>')}</g:Sheets></g:Workbook>`);
  expect(await runCommand(["--export-graphs", "-T", "unknown", "/original", "/none"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(f.stderr).toEqual([]);
  expect(Object.keys(f.volume.toJSON())).toEqual(["/original"]);
});
it.each(["emf", "wmf", "ani", "gif", "icns", "pnm", "qtif", "tga", "xbm", "xpm"])("preserves each unsupported %s renderer warning before its ordered save failure", async format => {
  const f = fixture();
  expect(await runCommand(["--export-graphs", "-T", format, "/original", "/unsupported-%n-%o.bin"], f.engine, f.operation)).toMatchObject({ exitCode: 1 });
  expect(f.stderr).toEqual(["Top", "Last", "First"].flatMap((name, index) => [
    "[GogRendererCairo:export_image] unsupported format\n",
    `Failed to write file:///unsupported-${index}-${name}.bin: Unknown failure while saving image\n`
  ]));
  expect(f.volume.toJSON()).toEqual({ "/original": source,
    "/unsupported-0-Top.bin": "", "/unsupported-1-Last.bin": "", "/unsupported-2-First.bin": "" });
});
it.each(["bad", "jpg", "PNG"])("preserves each unknown %s image ID warning before its ordered save failure", async format => {
  const f = fixture();
  expect(await runCommand(["--export-graphs", "-T", format, "/original", "/unknown-%n-%o.bin"], f.engine, f.operation)).toMatchObject({ exitCode: 1 });
  expect(f.stderr).toEqual(["Top", "Last", "First"].flatMap((name, index) => [
    `[GOImage::get_format_from_name] Unknown format name (${format})\n`,
    `Failed to write file:///unknown-${index}-${name}.bin: Unknown image format\n`
  ]));
  expect(f.volume.toJSON()).toEqual({ "/original": source,
    "/unknown-0-Top.bin": "", "/unknown-1-Last.bin": "", "/unknown-2-First.bin": "" });
});
it("uses persisted row/column defaults when measuring two-cell graph anchors", async () => {
  const f = fixture();
  const original = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61" Full="1.12.61"/><g:SheetNameIndex><g:SheetName Cols="256" Rows="65536">Metrics</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>Metrics</g:Name><g:Cols DefaultSizePts="20"/><g:Rows DefaultSizePts="30"/><g:Objects><g:SheetObjectGraph ObjectBound="A1:B2" ObjectOffset="0 0 0 0"><GogObject type="GogGraph"/></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`;
  f.volume.writeFileSync("/original", original);
  expect(await runCommand(["--export-graphs", "/original", "/metrics-%n.svg"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(f.volume.readFileSync("/metrics-0.svg", "utf8")).toContain('width="20" height="30"');
});
it.each([
  ["Col", "0.5 0 0 0", 10, 30],
  ["Row", "0 0.5 0 0", 20, 15]
] as const)("uses hidden %s nominal size for offsets and zero size for traversal", async (axis, offsets, width, height) => {
  const f = fixture();
  const cols = axis === "Col" ? '<g:ColInfo No="0" Unit="20" Count="1" Hidden="1"/>' : "";
  const rows = axis === "Row" ? '<g:RowInfo No="0" Unit="30" Count="1" Hidden="1"/>' : "";
  f.volume.writeFileSync("/original", `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Version Epoch="1" Major="12" Minor="61" Full="1.12.61"/><g:SheetNameIndex><g:SheetName Cols="256" Rows="65536">Hidden</g:SheetName></g:SheetNameIndex><g:Sheets><g:Sheet><g:Name>Hidden</g:Name><g:Cols DefaultSizePts="20">${cols}</g:Cols><g:Rows DefaultSizePts="30">${rows}</g:Rows><g:Objects><g:SheetObjectGraph ObjectBound="A1:B2" ObjectOffset="${offsets}"><GogObject type="GogGraph"/></g:SheetObjectGraph></g:Objects><g:Cells/></g:Sheet></g:Sheets></g:Workbook>`);
  expect(await runCommand(["--export-graphs", "/original", "/hidden-%n.svg"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(f.stderr).toEqual([]);
  expect(f.volume.readFileSync("/hidden-0.svg", "utf8")).toContain(`width="${width}" height="${height}"`);
});
it("falls back to SVG for .jpeg while .jpg selects the enum JPEG image ID", async () => {
  const f = fixture();
  expect(await runCommand(["--export-graphs", "/original", "/auto-%n.jpeg"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(String(f.volume.readFileSync("/auto-0.jpeg", "utf8")).startsWith('<?xml')).toBe(true);
  expect(await runCommand(["--export-graphs", "/original", "/auto-%n.jpg"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect([...new Uint8Array(f.volume.readFileSync("/auto-0.jpg") as Uint8Array).slice(0, 2)]).toEqual([255, 216]);
});
it.each(["0 0 71 35", "0 0 1 1440"])("exports a 1x1 PNG when either Cairo raster dimension rounds to zero: %s", async offsets => {
  const f = fixture();
  f.volume.writeFileSync("/original", `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${sheet("Tiny", graph("Tiny", offsets))}</g:Sheets></g:Workbook>`);
  expect(await runCommand(["--export-graphs", "-T", "png", "-O", "resolution=1", "/original", "/tiny-%n.png"], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(f.stderr).toEqual([]);
  const bytes = new Uint8Array(f.volume.readFileSync("/tiny-0.png") as Uint8Array);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([1, 1]);
});
it.each(["bmp", "ico", "tiff"])("exports unlisted writable profile target %s through the shared command engine", async format => {
  const f = fixture();
  expect(await runCommand(["--export-graphs", "-T", format, "/original", `/dynamic-%n.${format}`], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(f.stderr).toEqual([]);
  expect(Object.keys(f.volume.toJSON())).toEqual(["/original", ...[0, 1, 2, 3].map(index => `/dynamic-${index}.${format}`)]);
});

it.each(["svg", "png", "jpeg", "pdf", "ps", "eps", "bmp", "ico", "tiff"])("renders an explicit opaque solid graph background as %s", async format => {
  const f = fixture();
  const styled = graph("Solid", "0 0 72 36").replace('<GogObject type="GogGraph"/>', '<GogObject type="GogGraph"><property name="style" type="GogStyle"><line dash="none" auto-dash="0"/><fill type="pattern" auto-type="0" is-auto="0"><pattern type="solid" back="12:34:56:FF" fore="0:0:0:FF" auto-pattern="0"/></fill></property></GogObject>');
  f.volume.writeFileSync("/original", `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${sheet("Background", styled)}</g:Sheets></g:Workbook>`);
  expect(await runCommand(["--export-graphs", "-T", format, "/original", `/solid-%n.${format}`], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
  expect(f.stderr).toEqual([]);
  const bytes = new Uint8Array(f.volume.readFileSync(`/solid-0.${format}`) as Uint8Array);
  expect(bytes.length).toBeGreaterThan(0);
  if (format === "svg") expect(new TextDecoder().decode(bytes)).toContain('fill="#123456"');
  if (format === "png") {
    const { inflateSync } = await import("node:zlib");
    const view = new DataView(bytes.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([100, 50]);
    const pixels = inflateSync(bytes.subarray(41, 41 + view.getUint32(33)));
    for (let row = 0; row < 50; row++) {
      expect(pixels[row * 401]).toBe(0);
      for (let column = 0; column < 100; column++) expect([...pixels.subarray(row * 401 + 1 + column * 4, row * 401 + 5 + column * 4)]).toEqual([18, 52, 86, 255]);
    }
  }
});

it.each([
  '<font font="Sans 10" color="0:0:0:FF"/>',
  '<marker shape="circle" fill-color="FF:0:0:FF"/>',
  '<text_layout angle="45"/>'
])("does not reject unused root style metadata on a background-only graph: %s", async metadata => {
  const f = fixture();
  const paint = '<line dash="none" auto-dash="0"/><fill type="pattern" auto-type="0" is-auto="0"><pattern type="solid" back="12:34:56:FF" fore="0:0:0:FF" auto-pattern="0"/></fill>';
  const styled = (extra: string) => graph("Solid", "0 0 72 36").replace('<GogObject type="GogGraph"/>', `<GogObject type="GogGraph"><property name="style" type="GogStyle">${paint}${extra}</property></GogObject>`);
  for (const format of ["svg", "png", "jpeg", "pdf", "ps", "eps", "bmp", "ico", "tiff"]) {
    f.volume.writeFileSync("/original", `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${sheet("Background", styled(""))}</g:Sheets></g:Workbook>`);
    expect(await runCommand(["--export-graphs", "-T", format, "/original", `/plain-%n.${format}`], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
    f.volume.writeFileSync("/original", `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${sheet("Background", styled(metadata))}</g:Sheets></g:Workbook>`);
    expect(await runCommand(["--export-graphs", "-T", format, "/original", `/metadata-%n.${format}`], f.engine, f.operation)).toMatchObject({ exitCode: 0 });
    expect(f.volume.readFileSync(`/metadata-0.${format}`)).toEqual(f.volume.readFileSync(`/plain-0.${format}`));
  }
  expect(f.stderr).toEqual([]);
});
