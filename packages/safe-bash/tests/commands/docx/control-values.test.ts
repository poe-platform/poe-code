import assert from "node:assert/strict";
import test from "node:test";
import { Volume } from "memfs";
import { crc32 } from "../../../../office-package/src/index.js";
import { writeArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { textFixture, run, textContext } from "../../../../docx/tests/fixtures/text.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const control = (properties: string, text: string, id = 17) => `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:tag w:val="harbor"/>${properties}</w:sdtPr><w:sdtContent>${run(text)}</w:sdtContent></w:sdt>`;
async function fixture(properties: string, text = "Old value", body = `<w:p>${control(properties, text)}</w:p>`, input?: Uint8Array, files: Record<string, Buffer> = {}) {
  const bytes = input ?? await textFixture(body);
  const volume = Volume.fromJSON({ "/work/form with spaces.docx": Buffer.from(bytes), "/work/existing.docx": "destination retained", ...files });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  fs.access = async (path, mode) => { volume.accessSync(path, mode); };
  fs.stat = fs.lstat = async (path, options) => {
    options?.signal?.throwIfAborted();
    const value = volume.lstatSync(path);
    return { type: value.isDirectory() ? "directory" : "file", size: value.size, mode: value.mode,
      mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs, atimeMs: value.atimeMs, ino: value.ino,
      dev: value.dev, nlink: value.nlink };
  };
  fs.realpath = async path => String(volume.realpathSync(path));
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    return new Uint8Array(volume.readFileSync(path) as Uint8Array);
  };
  fs.readStream = (path, options) => ({ async *[Symbol.asyncIterator]() { yield await fs.readFile(path, options); } });
  const shell = new Shell({ fs, cwd: "/work" }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  return { shell, volume };
}

test("docx fills explicit plain controls through quoted VFS paths and binary stdin pipelines", async () => {
  const { shell, volume } = await fixture("<w:text/><w:showingPlcHdr/>");
  volume.writeFileSync("/work/fill.sh", "docx controls set 'form with spaces.docx' --control 1 --text 'Script value' --output - | docx text -\n");
  try {
    const result = await shell.exec("docx controls set 'form with spaces.docx' --control 1 --text 'Café coast' --output - | docx text -");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "Café coast");
    const script = await shell.exec("sh fill.sh");
    assert.equal(script.exitCode, 0, script.stderr);
    assert.equal(script.stdout, "Script value");
    const list = await shell.exec("docx controls list 'form with spaces.docx' --control 1 --json");
    assert.equal(list.exitCode, 0, list.stderr);
    const report = JSON.parse(list.stdout);
    assert.equal(report.operation, "controls.list");
    assert.equal(report.ok, true);
    assert.equal(report.affected, 0);
    assert.equal(report.data.items.length, 1);
    const empty = await shell.exec("docx controls set 'form with spaces.docx' --control 1 --text '' --output - | docx text -");
    assert.equal(empty.exitCode, 0, empty.stderr);
    assert.equal(empty.stdout, "");
  } finally { await shell.dispose(); }
});

function pixel(red: number): Uint8Array {
  const chunk = (kind: string, content: Uint8Array) => {
    const bytes = new Uint8Array(content.length + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, content.length);
    bytes.set(new TextEncoder().encode(kind), 4);
    bytes.set(content, 8);
    view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, bytes.length - 4)));
    return bytes;
  };
  const header = new Uint8Array(13);
  const dimensions = new DataView(header.buffer);
  dimensions.setUint32(0, 1); dimensions.setUint32(4, 1);
  header[8] = 8; header[9] = 2;
  const row = [0, red, 60, 90];
  let a = 1, b = 0;
  for (const value of row) { a = (a + value) % 65521; b = (b + a) % 65521; }
  const data = new Uint8Array([0x78, 1, 1, 4, 0, 251, 255, ...row, b >>> 8, b & 255, a >>> 8, a & 255]);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", data), chunk("IEND", new Uint8Array())];
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

test("docx picture controls acquire replacement PNG only through the declared command VFS", async () => {
  const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const drawing = '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Badge" descr="Retained description"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="2" name="Pixel"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="picture"/><a:srcRect l="1000"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const xml: Record<string, string> = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${relationships}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="${relationships}/image" Target="media/old.png"/></Relationships>`,
    "word/document.xml": `<w:document xmlns:w="${word}" xmlns:r="${relationships}"><w:body><w:p><w:sdt><w:sdtPr><w:id w:val="19"/><w:picture/></w:sdtPr><w:sdtContent>${drawing}</w:sdtContent></w:sdt></w:p></w:body></w:document>`,
  };
  const volume = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...Object.entries(xml).map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value), directory: false, modified: new Date("2025-01-02T03:04:06Z") })), { name: "word/media/old.png", bytes: pixel(20), directory: false, modified: new Date("2025-01-02T03:04:06Z") }] }, { async write(bytes) { volume.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  const { shell } = await fixture("", "", "", new Uint8Array(volume.readFileSync("/archive") as Buffer), { "/work/new pixel.png": Buffer.from(pixel(30)) });
  try {
    const result = await shell.exec("docx controls set 'form with spaces.docx' --control 1 --file 'new pixel.png' --output - | docx controls list - --json");
    assert.equal(result.exitCode, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.data.items[0].kind, "picture");
    assert.equal(report.data.items[0].placeholder, false);
  } finally { await shell.dispose(); }
});

test("docx renders declared choice labels and numeric dates without ambient locale", async () => {
  for (const [properties, flag, value, expected] of [
    ['<w:dropDownList><w:listItem w:displayText="Coastal blue" w:value="blue"/><w:listItem w:displayText="Warm amber" w:value="amber"/></w:dropDownList>', "choice", "amber", "Warm amber"],
    ['<w:date><w:dateFormat w:val="dd/MM/yyyy"/></w:date>', "date", "2024-02-29", "29/02/2024"],
  ]) {
    const { shell } = await fixture(properties!);
    try {
      const result = await shell.exec(`docx controls set 'form with spaces.docx' --control 1 --${flag} '${value}' --output - | docx text -`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  }
});

test("docx refuses locked and bound control filling while preserving input and destination", async () => {
  for (const properties of ['<w:text/><w:lock w:val="contentLocked"/>', '<w:text/><w:dataBinding w:storeItemID="{00000000-0000-0000-0000-000000000001}" w:xpath="/value"/>']) {
    const body = `<w:p>${control(properties, "Old value")}</w:p><w:p>${control("<w:text/>", "Sibling", 18)}</w:p>`;
    const { shell, volume } = await fixture(properties, "Old value", body);
    const before = volume.readFileSync("/work/form with spaces.docx");
    try {
      const result = await shell.exec("docx controls set 'form with spaces.docx' --control 1 --text new --output existing.docx --force --json");
      assert.notEqual(result.exitCode, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.data, null);
      assert.equal(report.affected, 0);
      assert.equal(report.errors[0].code, "unsupported-edit");
      assert.deepEqual(volume.readFileSync("/work/form with spaces.docx"), before);
      assert.equal(volume.readFileSync("/work/existing.docx", "utf8"), "destination retained");
      const sibling = await shell.exec("docx controls set 'form with spaces.docx' --control 2 --text 'New sibling' --output - | docx text -");
      assert.equal(sibling.exitCode, 0, sibling.stderr);
      assert.equal(sibling.stdout, "Old value\nNew sibling");
    } finally { await shell.dispose(); }
  }
});

test("docx mixed control kinds refuse all filling atomically while one matching control can fill", async () => {
  const checkbox = '<w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="Control Glyphs"/><w14:uncheckedState w14:val="2610" w14:font="Control Glyphs"/></w14:checkbox>';
  const body = `<w:p>${control("<w:text/>", "Old value")}</w:p><w:p>${control(checkbox, "☐", 18)}</w:p>`;
  const { shell, volume } = await fixture("", "", body);
  const before = volume.readFileSync("/work/form with spaces.docx");
  try {
    const result = await shell.exec("docx controls set 'form with spaces.docx' --all --text new --output existing.docx --force --json");
    assert.notEqual(result.exitCode, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.data, null);
    assert.equal(report.affected, 0);
    assert.equal(report.errors[0].code, "unsupported-edit");
    assert.deepEqual(volume.readFileSync("/work/form with spaces.docx"), before);
    assert.equal(volume.readFileSync("/work/existing.docx", "utf8"), "destination retained");
    const selected = await shell.exec("docx controls set 'form with spaces.docx' --control 1 --text new --output - | docx text -");
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.equal(selected.stdout, "new\n☐");
  } finally { await shell.dispose(); }
});

test("docx checkbox values use declared Unicode glyphs and preserve the typed false value", async () => {
  const properties = '<w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="Control Glyphs"/><w14:uncheckedState w14:val="2610" w14:font="Control Glyphs"/></w14:checkbox>';
  const { shell } = await fixture(properties, "☐");
  try {
    for (const [checked, expected] of [["true", "☒"], ["false", "☐"]]) {
      const result = await shell.exec(`docx controls set 'form with spaces.docx' --control 1 --checked ${checked} --output - | docx text -`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});

test("docx inventories nested controls and fills only an admitted nested leaf", async () => {
  const body = `<w:p><w:sdt><w:sdtPr><w:id w:val="18"/><w:richText/></w:sdtPr><w:sdtContent>${control("<w:text/>", "Leaf")}</w:sdtContent></w:sdt></w:p>`;
  const { shell } = await fixture("", "", body);
  try {
    const list = await shell.exec("docx controls list 'form with spaces.docx' --json");
    assert.equal(list.exitCode, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout).data.items.length, 2);
    const leaf = await shell.exec("docx controls set 'form with spaces.docx' --control 2 --text 'New leaf' --output - | docx text -");
    assert.equal(leaf.exitCode, 0, leaf.stderr);
    assert.equal(leaf.stdout, "New leaf");
    const parent = await shell.exec("docx controls set 'form with spaces.docx' --control 1 --text new --dry-run --json");
    assert.notEqual(parent.exitCode, 0);
    assert.equal(JSON.parse(parent.stdout).errors[0].code, "unsupported-edit");
    const all = await shell.exec("docx controls set 'form with spaces.docx' --all --text new --dry-run --json");
    assert.notEqual(all.exitCode, 0);
    assert.equal(JSON.parse(all.stdout).affected, 0);
  } finally { await shell.dispose(); }
});

test("docx refuses an undeclared choice instead of treating its display label as a value", async () => {
  const { shell } = await fixture('<w:dropDownList><w:listItem w:displayText="Harbor blue" w:value="blue"/></w:dropDownList>', "Harbor blue");
  try {
    const invalid = await shell.exec("docx controls set 'form with spaces.docx' --control 1 --choice 'Harbor blue' --dry-run --json");
    assert.notEqual(invalid.exitCode, 0);
    const report = JSON.parse(invalid.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.data, null);
    assert.equal(report.affected, 0);
    assert.equal(report.errors[0].code, "usage");
  } finally { await shell.dispose(); }
});
