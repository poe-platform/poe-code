import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import * as pptx from "pptx";
import { createPresentation, createPptxCommandEngine } from "pptx";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { parseXmlPart, type XmlElement } from "../../../../pptx/src/xml.js";
import { readPackage } from "../../../../pptx/src/package-reader.js";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";

const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
before(() => {
  const timer = globalThis.setTimeout;
  mock.method(globalThis, "setTimeout", ((callback: () => void, delay: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
after(() => mock.restoreAll());
function fixture(engineContext = context) {
  const volume = Volume.fromJSON({ "/work": null });
  const fs: FileSystem = new MemoryFileSystem();
  const identityScope = {};
  fs.stat = async (path) => {
    try {
      const entry = volume.statSync(path);
      return {
        type: entry.isDirectory() ? "directory" : "file",
        size: Number(entry.size),
        mode: Number(entry.mode),
        atimeMs: Number(entry.atimeMs),
        mtimeMs: Number(entry.mtimeMs),
        ctimeMs: Number(entry.ctimeMs),
        identityScope,
        dev: Number(entry.dev),
        ino: Number(entry.ino),
        revision: Number(entry.mtimeMs),
        nlink: Number(entry.nlink)
      };
    } catch (error) {
      throw new FsError((error as FsError).code);
    }
  };
  fs.lstat = async (path) => {
    const observed = await fs.stat(path);
    return volume.lstatSync(path).isSymbolicLink() ? { ...observed, type: "symlink" } : observed;
  };
  fs.access = async (path, mode) => {
    try {
      volume.accessSync(path, mode);
    } catch (error) {
      throw new FsError((error as FsError).code);
    }
  };
  fs.writeFileConditional = async (path, bytes, options) => {
    options.signal?.throwIfAborted();
    const current = volume.existsSync(path) ? await fs.lstat(path) : null;
    if (
      current?.ino !== options.expected?.ino ||
      current?.size !== options.expected?.size ||
      current?.revision !== options.expected?.revision
    )
      throw new FsError("EAGAIN");
    volume.writeFileSync(path, bytes);
    return fs.stat(path);
  };
  fs.readStream = async function* (path, options) {
    options?.signal?.throwIfAborted();
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  };
  fs.readFile = async (path, options) => {
    options?.signal?.throwIfAborted();
    const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
    if (options?.maxBytes !== undefined && bytes.length > options.maxBytes)
      throw new FsError("EFBIG");
    return bytes;
  };
  const shell = new Shell({ fs, cwd: "/work" }).use(
    pptxCommands({
      engine: createPptxCommandEngine({
        context: engineContext,
        maxOutputBytes: 262144,
        maxArgumentBytes: 65536
      })
    })
  );
  return { shell, fs, volume };
}

test("table creation preserves a rectangular Unicode grid through a virtual script", async () => {
  const { shell, volume } = fixture();
  const input = await createPresentation({ slides: [{}] }, context);
  volume.writeFileSync("/work/input deck.pptx", input);
  volume.writeFileSync("/work/tables.sh", `pptx tables add 'input deck.pptx' --slide 1 --rows 2 --columns 2 --left 0emu --top 0emu --width 101emu --height 61emu --data '[["Coast",""],["海 🐚","é"]]' --output 'grid deck.pptx' --json
pptx tables list 'grid deck.pptx' --json`);
  try {
    const result = await shell.exec("sh tables.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const lines = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(lines[0].operation, "tables.add");
    assert.equal(lines[0].affected, 1);
    assert.equal(lines[1].operation, "tables.list");
    assert.equal(lines[1].affected, 0);
    const bytes = new Uint8Array(volume.readFileSync("/work/grid deck.pptx") as Buffer);
    const expected = await pptx.addTable(input, { slide: 1, update: {
      rows: 2, columns: 2, left: { value: 0, unit: "emu" }, top: { value: 0, unit: "emu" },
      width: { value: 101, unit: "emu" }, height: { value: 61, unit: "emu" }, data: [["Coast", ""], ["海 🐚", "é"]]
    } }, context);
    assert.deepEqual(bytes, expected.bytes);
    const records = await pptx.readTables(bytes, { slide: 1, table: 1 }, context);
    assert.equal(records.length, 1);
    assert.deepEqual(lines[1].data.records, records);
    const { xml } = await pptx.getXmlPart(bytes, "/ppt/slides/slide1.xml", {
      ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 }
    });
    const columns: string[] = [];
    const rows: string[] = [];
    const texts: string[] = [];
    let cells = 0;
    let inText = false;
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", tag => {
      if (tag.uri !== "http://schemas.openxmlformats.org/drawingml/2006/main") return;
      if (tag.local === "gridCol") columns.push(tag.attributes.w!.value);
      if (tag.local === "tr") rows.push(tag.attributes.h!.value);
      if (tag.local === "tc") cells++;
      if (tag.local === "t") inText = true;
    });
    parser.on("text", text => { if (inText) texts.push(text); });
    parser.on("closetag", tag => { if (tag.local === "t") inText = false; });
    parser.write(xml).close();
    assert.deepEqual(columns, ["51", "50"]);
    assert.deepEqual(rows, ["31", "30"]);
    assert.equal(cells, 4);
    assert.deepEqual(texts, ["Coast", "海 🐚", "é"]);
  } finally { await shell.dispose(); }
});

test("table cell text no-op preserves package hash and dry-run leaves files unchanged", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await createPresentation({ slides: [{}] }, context));
  try {
    const added = await shell.exec("pptx tables add deck.pptx --slide 1 --rows 1 --columns 2 --left 0emu --top 0emu --width 100emu --height 60emu --in-place --json");
    assert.equal(added.exitCode, 0, added.stdout + added.stderr);
    const before = new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer);
    const unchanged = await shell.exec("pptx tables set deck.pptx --slide 1 --table 1 --cell 1,2 --text '' --in-place --json");
    assert.equal(unchanged.exitCode, 0, unchanged.stdout + unchanged.stderr);
    assert.equal(createHash("sha256").update(volume.readFileSync("/work/deck.pptx") as Buffer).digest("hex"), createHash("sha256").update(before).digest("hex"));
    const dry = await shell.exec("pptx tables set deck.pptx --slide 1 --table 1 --cell 1,2 --text 'Draft' --dry-run --json");
    assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
    assert.equal(JSON.parse(dry.stdout).affected, 1);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), before);
    const changed = await shell.exec("pptx tables set deck.pptx --slide 1 --table 1 --cell 1,2 --text 'Draft' --fill 335577 --border-color 112233 --border-width 2pt --in-place --json");
    assert.equal(changed.exitCode, 0, changed.stdout + changed.stderr);
    const sdk = await pptx.mutateTables(before, { slide: 1, table: 1, cell: "1,2", update: {
      text: "Draft", fill: "335577", borderColor: "112233", borderWidth: { value: 2, unit: "pt" }
    } }, context);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), sdk.bytes);
    const table = (await pptx.readTables(sdk.bytes, { slide: 1, table: 1 }, context))[0]!;
    assert.deepEqual(table.data, [["", "Draft"]]);
    assert.equal(table.cells[0]!.fill, null);
    assert.equal(table.cells[1]!.fill, "335577");
  } finally { await shell.dispose(); }
});

test("table cell formatting retains theme links, dimensions and explicit zero margins", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await createPresentation({ slides: [{}] }, context));
  try {
    const added = await shell.exec("pptx tables add deck.pptx --slide 1 --rows 2 --columns 2 --left 0emu --top 0emu --width 100emu --height 60emu --style '{76C319E0-2DF8-4D13-B662-4D2E3C94B3A1}' --in-place --json");
    assert.equal(added.exitCode, 0, added.stdout + added.stderr);
    const initial = new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer);
    const xmlContext = { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 } };
    const part = await pptx.getXmlPart(initial, "/ppt/slides/slide1.xml", xmlContext);
    const document = parseXmlPart(part.bytes, context.xmlLimits);
    const cellProperties: XmlElement[] = [];
    function visit(node: XmlElement) {
      if (node.name.localName === "tcPr") cellProperties.push(node);
      for (const child of node.children) visit(child);
    }
    visit(document.root);
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const authored = document.spliceChildren(cellProperties[2]!, 0, 0, [
      ...["lnL", "lnR", "lnT", "lnB"].map(name => `<a:${name} xmlns:a="${a}" w="12700"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:${name}>`),
      `<a:solidFill xmlns:a="${a}"><a:schemeClr val="accent3"/></a:solidFill>`
    ]);
    const archive = await readPackage(initial, context);
    const before = storedArchive(archive.names.map(name => ({ name: name.slice(1), bytes: name === "/ppt/slides/slide1.xml" ? authored.bytes() : archive.get(name) })));
    volume.writeFileSync("/work/deck.pptx", before);
    const formatted = await shell.exec("pptx tables set deck.pptx --slide 1 --table 1 --cell 2,1 --margin-left 0emu --margin-right 2pt --margin-top 3pt --margin-bottom 4pt --row-height 2in --column-width 3in --in-place --json");
    assert.equal(formatted.exitCode, 0, formatted.stdout + formatted.stderr);
    const bytes = new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer);
    const expected = await pptx.mutateTables(before, { slide: 1, table: 1, cell: "2,1", update: {
      marginLeft: { value: 0, unit: "emu" }, marginRight: { value: 2, unit: "pt" },
      marginTop: { value: 3, unit: "pt" }, marginBottom: { value: 4, unit: "pt" },
      rowHeight: { value: 2, unit: "in" }, columnWidth: { value: 3, unit: "in" }
    } }, context);
    assert.deepEqual(bytes, expected.bytes);
    const { xml } = await pptx.getXmlPart(bytes, "/ppt/slides/slide1.xml", {
      ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 }
    });
    const tags: { name: string; attributes: Record<string, string> }[] = [];
    let inStyle = false;
    let style = "";
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", tag => {
      if (tag.local === "tableStyleId") inStyle = true;
      if (tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main")
        tags.push({ name: tag.local, attributes: Object.fromEntries(Object.values(tag.attributes).map(value => [value.local, value.value])) });
    });
    parser.on("text", text => { if (inStyle) style += text; });
    parser.on("closetag", tag => { if (tag.local === "tableStyleId") inStyle = false; });
    parser.write(xml).close();
    assert.equal(style, "{76C319E0-2DF8-4D13-B662-4D2E3C94B3A1}");
    assert.deepEqual(tags.filter(tag => tag.name === "gridCol").map(tag => tag.attributes.w), ["2743200", "50"]);
    assert.deepEqual(tags.filter(tag => tag.name === "tr").map(tag => tag.attributes.h), ["30", "1828800"]);
    assert.deepEqual(tags.filter(tag => tag.name === "tcPr")[2]!.attributes, { marL: "0", marR: "25400", marT: "38100", marB: "50800" });
    assert.equal(tags.filter(tag => tag.name === "schemeClr" && tag.attributes.val === "accent3").length, 1);
    assert.equal(tags.filter(tag => tag.name === "schemeClr" && tag.attributes.val === "accent2").length, 4);
    assert.deepEqual(tags.filter(tag => ["lnL", "lnR", "lnT", "lnB"].includes(tag.name)).map(tag => tag.attributes.w), ["12700", "12700", "12700", "12700"]);
  } finally { await shell.dispose(); }
});

test("table usage errors reject invalid grids and dimensions before publication", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await createPresentation({ slides: [{}] }, context));
  try {
    const bytes = new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer);
    for (const [flags, exit] of [["--rows 0 --columns 2", 2], ["--rows 2 --columns 2 --data '[[\"one\"]]'", 1], ["--rows 1 --columns 1 --width 10", 2]] as const) {
      const result = await shell.exec(`pptx tables add deck.pptx --slide 1 --left 0emu --top 0emu --width 100emu --height 60emu ${flags} --output invalid.pptx --json`);
      assert.equal(result.exitCode, exit, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).affected, 0);
      assert.equal(volume.existsSync("/work/invalid.pptx"), false);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), bytes);
    }
  } finally { await shell.dispose(); }
});
