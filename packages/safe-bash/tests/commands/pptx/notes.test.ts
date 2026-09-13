import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { compileJsonSchema } from "toolcraft-schema";
import {
  createPptxCommandEngine,
  createPresentation,
  readNotes,
  readPresentationSettings,
  replacePresentationText
} from "pptx";
import { parseXmlPart } from "../../../../pptx/src/xml.js";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { pptxCommands } from "../../../src/commands/pptx/index.js";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

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

test("notes reads do not create missing note slides or alter input bytes", async () => {
  const { shell, volume } = fixture();
  const original = await createPresentation(
    { slides: [{ name: "Harbor" }, { name: "Forest" }] },
    context
  );
  volume.writeFileSync("/work/deck.pptx", original);
  try {
    const result = await shell.exec("pptx notes list deck.pptx --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.operation, "notes.list");
    assert.equal(envelope.affected, 0);
    assert.deepEqual(volume.readFileSync("/work/deck.pptx"), Buffer.from(original));
    assert.equal(
      inspectZip(original).some((entry) => entry.name.startsWith("ppt/notesSlides/")),
      false
    );
  } finally {
    await shell.dispose();
  }
});

async function authoredNotes(opaque = true) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const encoder = new TextEncoder();
  const parts = new Map(
    inspectZip(await createPresentation({ slides: [{ name: "Harbor" }] }, context)).map((entry) => [
      entry.name,
      entry.payload
    ])
  );
  const append = (part: string, fragment: string) => {
    const xml = parseXmlPart(parts.get(part)!, context.xmlLimits);
    parts.set(part, xml.spliceChildren(xml.root, xml.root.children.length, 0, [fragment]).bytes());
  };
  const shape = (id: number, name: string, type: string | null, text: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${type === null ? "" : `<p:ph type="${type}" idx="${id}"/>`}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const scene = (kind: string, content: string) =>
    `<p:${kind} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${content}</p:spTree></p:cSld>${kind === "notesMaster" ? "<p:clrMap/>" : ""}</p:${kind}>`;
  append(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationship xmlns="${rel}" Id="speaker" Type="${r}/notesSlide" Target="../notesSlides/note.xml"/>`
  );
  append(
    "ppt/_rels/presentation.xml.rels",
    `<Relationship xmlns="${rel}" Id="notesMaster" Type="${r}/notesMaster" Target="notesMasters/master.xml"/>`
  );
  append(
    "ppt/presentation.xml",
    `<p:notesMasterIdLst xmlns:p="${p}" xmlns:r="${r}"><p:notesMasterId r:id="notesMaster"/></p:notesMasterIdLst>`
  );
  parts.set(
    "ppt/notesSlides/note.xml",
    encoder.encode(
      scene(
        "notes",
        shape(2, "Speaker", "body", "Harbor briefing") +
          shape(3, "Date", "dt", "Date unchanged") +
          shape(4, "Footer", "ftr", "Footer unchanged") +
          shape(5, "Preview", "sldImg", "Preview unchanged") +
          shape(6, "Annotation", null, "Extra annotation") +
          (opaque
            ? '<p:extLst><p:ext uri="urn:original:note"><custom:keep xmlns:custom="urn:original:note">opaque</custom:keep></p:ext></p:extLst>'
            : "")
      )
    )
  );
  parts.set(
    "ppt/notesSlides/_rels/note.xml.rels",
    encoder.encode(
      `<Relationships xmlns="${rel}"><Relationship Id="slide" Type="${r}/slide" Target="../slides/slide1.xml"/><Relationship Id="master" Type="${r}/notesMaster" Target="../notesMasters/master.xml"/></Relationships>`
    )
  );
  parts.set(
    "ppt/notesMasters/master.xml",
    encoder.encode(scene("notesMaster", shape(2, "Master footer", "ftr", "Shared imprint")))
  );
  for (const [part, type] of [
    ["notesSlides/note.xml", "notesSlide"],
    ["notesMasters/master.xml", "notesMaster"]
  ]) {
    append(
      "[Content_Types].xml",
      `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`
    );
  }
  return storedArchive([...parts].map(([name, bytes]) => ({ name, bytes })));
}

async function authoredHandout(opaque = true) {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const encoder = new TextEncoder();
  const parts = new Map(
    inspectZip(
      await createPresentation(
        {
          slides: ["Harbor briefing", "Forest briefing"].map((text) => ({
            shapes: [{ x: 0, y: 0, width: 1000000, height: 500000, text }]
          }))
        },
        context
      )
    ).map((entry) => [entry.name, entry.payload])
  );
  const append = (part: string, fragment: string) => {
    const xml = parseXmlPart(parts.get(part)!, context.xmlLimits);
    parts.set(part, xml.spliceChildren(xml.root, xml.root.children.length, 0, [fragment]).bytes());
  };
  const shape = (id: number, kind: string, text: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Panel ${id}"/><p:cNvSpPr/><p:nvPr><p:ph type="${kind}" idx="${id}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  parts.set(
    "ppt/handoutMasters/handout.xml",
    encoder.encode(
      `<p:handoutMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld name="Printed overview"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape(2, "ftr", "Harbor imprint")}${shape(3, "sldImg", "Preview retained")}</p:spTree></p:cSld><p:clrMap/><p:hf hdr="0" ftr="1" dt="0" sldNum="1"/></p:handoutMaster>`
    )
  );
  parts.set(
    "ppt/print-settings.xml",
    encoder.encode(
      `<p:presentationPr xmlns:p="${p}"><p:prnPr prnWhat="handouts4" clrMode="gray" hiddenSlides="1" frameSlides="0" scaleToFitPaper="1"/></p:presentationPr>`
    )
  );
  parts.set(
    "ppt/window-settings.xml",
    encoder.encode(
      `<p:viewPr xmlns:p="${p}" lastView="handoutView" showComments="0"><p:gridSpacing cx="72000" cy="144000"/>${opaque ? '<p:extLst><p:ext uri="urn:original:window"><v:retained xmlns:v="urn:original:window" value="opaque"/></p:ext></p:extLst>' : ""}</p:viewPr>`
    )
  );
  for (const [id, type, target] of [
    ["handout", "handoutMaster", "handoutMasters/handout.xml"],
    ["print", "presProps", "print-settings.xml"],
    ["window", "viewProps", "window-settings.xml"]
  ])
    append(
      "ppt/_rels/presentation.xml.rels",
      `<Relationship xmlns="${rel}" Id="${id}" Type="${r}/${type}" Target="${target}"/>`
    );
  const initial = parseXmlPart(parts.get("ppt/presentation.xml")!, context.xmlLimits);
  parts.set(
    "ppt/presentation.xml",
    initial
      .spliceChildren(
        initial.root,
        initial.root.children.findIndex((node) => node.name.localName === "sldIdLst"),
        0,
        [
          `<p:handoutMasterIdLst xmlns:p="${p}" xmlns:r="${r}"><p:handoutMasterId r:id="handout"/></p:handoutMasterIdLst>`
        ]
      )
      .bytes()
  );
  const document = parseXmlPart(parts.get("ppt/presentation.xml")!, context.xmlLimits);
  const notes = document.root.children.find((node) => node.name.localName === "notesSz")!;
  parts.set(
    "ppt/presentation.xml",
    document
      .merge(notes, {
        attributes: [
          { namespace: "", localName: "cx", value: "6000000" },
          { namespace: "", localName: "cy", value: "9000000" }
        ]
      })
      .bytes()
  );
  for (const [part, type] of [
    ["handoutMasters/handout.xml", "handoutMaster"],
    ["print-settings.xml", "presProps"],
    ["window-settings.xml", "viewProps"]
  ])
    append(
      "[Content_Types].xml",
      `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`
    );
  return { bytes: storedArchive([...parts].map(([name, bytes]) => ({ name, bytes }))), parts };
}

test("handout inventory and print settings agree through the public SDK and virtual CLI", async () => {
  const { shell, volume } = fixture();
  const { bytes: original } = await authoredHandout();
  volume.writeFileSync("/work/deck.pptx", original);
  try {
    const inspect = await shell.exec("pptx inspect deck.pptx --json");
    assert.equal(inspect.exitCode, 0, inspect.stdout + inspect.stderr);
    assert.deepEqual(JSON.parse(inspect.stdout).data.inventory.handoutMasters, [
      "/ppt/handoutMasters/handout.xml"
    ]);
    const inspectSchema = await shell.exec("pptx schema inspect --json");
    assert.equal(inspectSchema.exitCode, 0, inspectSchema.stdout + inspectSchema.stderr);
    assert.equal(
      compileJsonSchema(JSON.parse(inspectSchema.stdout).data.operations.inspect.result).validate(
        JSON.parse(inspect.stdout)
      ).ok,
      true
    );
    const result = await shell.exec("pptx settings get deck.pptx --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const record = JSON.parse(result.stdout);
    assert.equal(record.affected, 0);
    const settings = record.data.settings;
    assert.deepEqual(settings, await readPresentationSettings(original, context));
    assert.deepEqual(
      [settings.notesWidth, settings.notesHeight, settings.notesOrientation],
      [6000000, 9000000, "portrait"]
    );
    assert.equal(settings.printProperties.part, "/ppt/print-settings.xml");
    assert.ok(settings.printProperties.xml.includes('prnWhat="handouts4"'));
    assert.equal(settings.viewProperties.part, "/ppt/window-settings.xml");
    assert.ok(settings.viewProperties.xml.includes('lastView="handoutView"'));
    assert.ok(settings.viewProperties.xml.includes('value="opaque"'));
    const capability = await shell.exec("pptx capabilities --json");
    assert.equal(capability.exitCode, 0, capability.stdout + capability.stderr);
    assert.ok(
      JSON.parse(capability.stdout).data.features.settings.subset.includes(
        "Print and view properties are inventoried"
      )
    );
    const schema = await shell.exec("pptx schema settings get --json");
    assert.equal(schema.exitCode, 0, schema.stdout + schema.stderr);
    assert.equal(
      compileJsonSchema(JSON.parse(schema.stdout).data.operations["settings.get"].result).validate(
        record
      ).ok,
      true
    );
    assert.deepEqual(volume.readFileSync("/work/deck.pptx"), Buffer.from(original));
  } finally {
    await shell.dispose();
  }
});

test("slide edits and default text replacement retain handout print and view resources", async () => {
  const { shell, volume } = fixture();
  const { bytes: original, parts: originalParts } = await authoredHandout();
  volume.writeFileSync("/work/deck.pptx", original);
  try {
    for (const command of [
      "pptx text replace deck.pptx --find Harbor --with Coastal --all --in-place --json",
      "pptx slides duplicate deck.pptx --slide 1 --position 2 --in-place --json",
      "pptx slides move deck.pptx --slide 2 --position 3 --in-place --json"
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      const parts = new Map(
        inspectZip(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer)).map(
          (entry) => [entry.name, entry.payload]
        )
      );
      for (const name of [
        "ppt/handoutMasters/handout.xml",
        "ppt/print-settings.xml",
        "ppt/window-settings.xml"
      ])
        assert.deepEqual(parts.get(name), originalParts.get(name), name);
      const parser = new SaxesParser({ xmlns: true });
      const notes: string[][] = [];
      parser.on("opentag", (node) => {
        if (
          node.uri === "http://schemas.openxmlformats.org/presentationml/2006/main" &&
          node.local === "notesSz"
        )
          notes.push([node.attributes.cx!.value, node.attributes.cy!.value]);
      });
      parser.write(new TextDecoder().decode(parts.get("ppt/presentation.xml"))).close();
      assert.deepEqual(notes, [["6000000", "9000000"]]);
    }
    const sdkReplacement = await replacePresentationText(
      new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer),
      { scope: "handout-master", find: "Harbor imprint", with: "Coastal imprint", all: true },
      context
    );
    const scoped = await shell.exec(
      "pptx text replace deck.pptx --scope handout-master --find 'Harbor imprint' --with 'Coastal imprint' --all --in-place --json"
    );
    assert.equal(scoped.exitCode, 0, scoped.stdout + scoped.stderr);
    assert.equal(JSON.parse(scoped.stdout).affected, 1);
    assert.equal(sdkReplacement.affected, 1);
    assert.deepEqual(volume.readFileSync("/work/deck.pptx"), Buffer.from(sdkReplacement.bytes));
    const parts = new Map(
      inspectZip(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer)).map((entry) => [
        entry.name,
        entry.payload
      ])
    );
    const handout = new TextDecoder().decode(parts.get("ppt/handoutMasters/handout.xml"));
    assert.ok(handout.includes("Coastal imprint"));
    assert.ok(handout.includes("Preview retained"));
    assert.ok(handout.includes('<p:hf hdr="0" ftr="1" dt="0" sldNum="1"/>'));
    for (const name of ["ppt/print-settings.xml", "ppt/window-settings.xml"])
      assert.deepEqual(parts.get(name), originalParts.get(name));
    const beforeRejected = volume.readFileSync("/work/deck.pptx");
    const rejected = await shell.exec(
      "pptx text replace deck.pptx --scope handout-master --slide 1 --find Coastal --with Lost --all --in-place --json"
    );
    assert.equal(rejected.exitCode, 2, rejected.stdout + rejected.stderr);
    assert.deepEqual(volume.readFileSync("/work/deck.pptx"), beforeRejected);
    const removal = await shell.exec("pptx slides remove deck.pptx --slide 2 --in-place --json");
    assert.equal(removal.exitCode, 1, removal.stdout + removal.stderr);
    assert.equal(JSON.parse(removal.stdout).errors[0].code, "dangling-reference");
    assert.deepEqual(volume.readFileSync("/work/deck.pptx"), beforeRejected);
    const plain = await authoredHandout(false);
    volume.writeFileSync("/work/plain.pptx", plain.bytes);
    const removed = await shell.exec("pptx slides remove plain.pptx --slide 2 --in-place --json");
    assert.equal(removed.exitCode, 0, removed.stdout + removed.stderr);
    const retained = new Map(
      inspectZip(new Uint8Array(volume.readFileSync("/work/plain.pptx") as Buffer)).map((entry) => [
        entry.name,
        entry.payload
      ])
    );
    for (const name of [
      "ppt/handoutMasters/handout.xml",
      "ppt/print-settings.xml",
      "ppt/window-settings.xml"
    ])
      assert.deepEqual(retained.get(name), plain.parts.get(name));
  } finally {
    await shell.dispose();
  }
});

test("speaker edits preserve placeholders, free note shapes and opaque note content", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/harbor deck.pptx", await authoredNotes());
  try {
    const read = await shell.exec("pptx notes get 'harbor deck.pptx' --slide 1 --json");
    assert.equal(read.exitCode, 0, read.stdout + read.stderr);
    assert.ok(read.stdout.includes("Harbor briefing"));
    for (const excluded of [
      "Date unchanged",
      "Footer unchanged",
      "Preview unchanged",
      "Extra annotation"
    ])
      assert.equal(read.stdout.includes(excluded), false);
    const changed = await shell.exec(
      "pptx notes set 'harbor deck.pptx' --slide 1 --text '明日 é 🐚' --in-place --json"
    );
    assert.equal(changed.exitCode, 0, changed.stdout + changed.stderr);
    assert.equal(JSON.parse(changed.stdout).affected, 1);
    const sdk = await readNotes(
      new Uint8Array(volume.readFileSync("/work/harbor deck.pptx") as Buffer),
      {},
      context
    );
    assert.deepEqual(
      sdk.map((note) => [note.slide, note.text, note.bodyShapeId]),
      [[1, "明日 é 🐚", "2"]]
    );
    const entries = new Map(
      inspectZip(new Uint8Array(volume.readFileSync("/work/harbor deck.pptx") as Buffer)).map(
        (entry) => [entry.name, new TextDecoder().decode(entry.payload)]
      )
    );
    const note = entries.get("ppt/notesSlides/note.xml")!;
    assert.ok(note.includes("明日 é 🐚"));
    assert.equal(note.includes("Harbor briefing"), false);
    for (const retained of [
      "Date unchanged",
      "Footer unchanged",
      "Preview unchanged",
      "Extra annotation",
      '<custom:keep xmlns:custom="urn:original:note">opaque</custom:keep>'
    ])
      assert.ok(note.includes(retained), retained);
    assert.ok(entries.get("ppt/notesMasters/master.xml")!.includes("Shared imprint"));
    const rejected = await shell.exec(
      "pptx notes add 'harbor deck.pptx' --slide 1 --text duplicate --in-place --json"
    );
    assert.equal(rejected.exitCode, 1, rejected.stdout + rejected.stderr);
    assert.equal(JSON.parse(rejected.stdout).affected, 0);
  } finally {
    await shell.dispose();
  }
});

test("explicit note shape and notes-master text scopes retain separate ownership", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await authoredNotes());
  try {
    for (const command of [
      "pptx text frames set deck.pptx --scope notes --slide 1 --shape Footer --margin-left 1pt --in-place --json",
      "pptx text replace deck.pptx --scope notes --slide 1 --shape Footer --find 'Footer unchanged' --with 'Local footer' --all --in-place --json",
      "pptx text replace deck.pptx --scope notes-master --find 'Shared imprint' --with 'Master revised' --all --in-place --json"
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    }
    const entries = new Map(
      inspectZip(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer)).map((entry) => [
        entry.name,
        new TextDecoder().decode(entry.payload)
      ])
    );
    const note = entries.get("ppt/notesSlides/note.xml")!;
    for (const retained of [
      "Harbor briefing",
      "Date unchanged",
      "Preview unchanged",
      "Extra annotation",
      "Local footer",
      'lIns="12700"'
    ])
      assert.ok(note.includes(retained), retained);
    assert.ok(entries.get("ppt/notesMasters/master.xml")!.includes("Master revised"));
  } finally {
    await shell.dispose();
  }
});

test("virtual script creates, duplicates and removes notes without changing the original owner", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/deck.pptx",
    await createPresentation({ slides: [{ name: "Harbor" }, { name: "Forest" }] }, context)
  );
  volume.writeFileSync(
    "/work/notes.sh",
    "pptx notes add deck.pptx --slide 1 --text 'Tidal overview' --in-place --json\npptx slides duplicate deck.pptx --slide 1 --position 2 --in-place --json\npptx notes set deck.pptx --slide 2 --text 'Copy briefing' --in-place --json\npptx notes get deck.pptx --slide 1 --json\npptx notes get deck.pptx --slide 2 --json"
  );
  try {
    const result = await shell.exec("sh notes.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const envelopes = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(envelopes.length, 5);
    assert.ok(envelopes.every((envelope) => envelope.ok));
    assert.ok(JSON.stringify(envelopes[3].data).includes("Tidal overview"));
    assert.equal(JSON.stringify(envelopes[3].data).includes("Copy briefing"), false);
    assert.ok(JSON.stringify(envelopes[4].data).includes("Copy briefing"));
    const removed = await shell.exec("pptx notes remove deck.pptx --slide 2 --in-place --json");
    assert.equal(removed.exitCode, 0, removed.stdout + removed.stderr);
    const original = await shell.exec("pptx notes get deck.pptx --slide 1 --json");
    assert.equal(original.exitCode, 0, original.stdout + original.stderr);
    assert.ok(original.stdout.includes("Tidal overview"));
    const copied = await shell.exec("pptx notes get deck.pptx --slide 2 --json");
    assert.equal(copied.exitCode, 0, copied.stdout + copied.stderr);
    assert.equal(copied.stdout.includes("Copy briefing"), false);
    const deleted = await shell.exec("pptx slides remove deck.pptx --slide 1 --in-place --json");
    assert.equal(deleted.exitCode, 0, deleted.stdout + deleted.stderr);
    const remaining = await shell.exec("pptx notes list deck.pptx --json");
    assert.equal(remaining.exitCode, 0, remaining.stdout + remaining.stderr);
    assert.equal(remaining.stdout.includes("Tidal overview"), false);
  } finally {
    await shell.dispose();
  }
});

test("notes dry-run, cardinality and schema failures leave the virtual input unchanged", async () => {
  const { shell, volume } = fixture();
  const original = await createPresentation({ slides: [{}, {}] }, context);
  volume.writeFileSync("/work/deck.pptx", original);
  try {
    for (const [command, exit] of [
      ["pptx notes set deck.pptx --slide 1 --text Trial --dry-run --json", 0],
      ["pptx notes set deck.pptx --text Trial --in-place --json", 1],
      ["pptx notes set deck.pptx --slide 0 --text Trial --in-place --json", 2],
      ["pptx notes set deck.pptx --scope slides --slide 1 --text Trial --in-place --json", 2]
    ] as const) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, exit, result.stdout + result.stderr);
      assert.deepEqual(volume.readFileSync("/work/deck.pptx"), Buffer.from(original));
    }
  } finally {
    await shell.dispose();
  }
});

test("notes schemas reject foreign fields and validate command records and stale tokens", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await authoredNotes());
  try {
    for (const action of ["list", "get", "add", "set", "remove"]) {
      const schemaResult = await shell.exec(`pptx schema notes ${action} --json`);
      assert.equal(schemaResult.exitCode, 0, schemaResult.stdout + schemaResult.stderr);
      const schema = JSON.parse(schemaResult.stdout).data.operations[`notes.${action}`];
      const validator = compileJsonSchema(schema.options);
      const options = ["list", "get"].includes(action)
        ? { slide: 1, json: true }
        : { slide: 1, dryRun: true, ...(action === "remove" ? {} : { text: "" }) };
      assert.equal(validator.validate(options).ok, true);
      for (const invalid of [
        { ...options, scope: "slides" },
        { ...options, shape: "Footer" },
        { ...options, slide: 0 },
        { ...options, select: "opaque", scope: "notes" }
      ])
        assert.equal(validator.validate(invalid).ok, false);
      if (["list", "get"].includes(action)) {
        const result = await shell.exec(`pptx notes ${action} deck.pptx --slide 1 --json`);
        assert.equal(result.exitCode, 0, result.stdout + result.stderr);
        const record = JSON.parse(result.stdout);
        assert.equal(compileJsonSchema(schema.result).validate(record).ok, true);
        assert.equal(record.data.notes[0].text, "Harbor briefing");
        const token = record.data.notes[0].selector;
        const selected = await shell.exec(
          `pptx notes ${action} deck.pptx --select '${token}' --json`
        );
        assert.equal(selected.exitCode, 0, selected.stdout + selected.stderr);
      }
    }
    const list = await shell.exec("pptx notes list deck.pptx --json");
    const token = JSON.parse(list.stdout).data.notes[0].selector;
    const edited = await shell.exec(
      "pptx notes set deck.pptx --slide 1 --text Later --in-place --json"
    );
    assert.equal(edited.exitCode, 0, edited.stdout + edited.stderr);
    const stale = await shell.exec(
      `pptx notes set deck.pptx --select '${token}' --text Invalid --in-place --json`
    );
    assert.equal(stale.exitCode, 1);
    assert.equal(JSON.parse(stale.stdout).errors[0].code, "stale-selection");
    for (const flags of ["--shape Footer", "--scope slides", "--unknown true"]) {
      const rejected = await shell.exec(`pptx notes list deck.pptx ${flags} --json`);
      assert.equal(rejected.exitCode, 2, rejected.stdout + rejected.stderr);
    }
  } finally {
    await shell.dispose();
  }
});

test("slide import retains source notes and rejects competing masters without publication", async () => {
  const { shell, volume } = fixture();
  const bytes = await authoredNotes(false);
  volume.writeFileSync("/work/destination.pptx", bytes);
  volume.writeFileSync("/work/source.pptx", bytes);
  volume.writeFileSync(
    "/work/empty.pptx",
    await createPresentation({ slides: [{ name: "Destination" }] }, context)
  );
  try {
    for (const command of [
      "pptx text replace source.pptx --scope notes-master --find 'Shared imprint' --with 'Source imprint' --all --in-place --json",
      "pptx notes set source.pptx --slide 1 --text 'Source briefing' --in-place --json"
    ]) {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    }
    const rejected = await shell.exec(
      "pptx slides import destination.pptx --source source.pptx --source-slides '[1]' --in-place --json"
    );
    assert.equal(rejected.exitCode, 1, rejected.stdout + rejected.stderr);
    assert.equal(JSON.parse(rejected.stdout).errors[0].code, "unsupported-edit");
    assert.equal(JSON.parse(rejected.stdout).affected, 0);
    assert.deepEqual(volume.readFileSync("/work/destination.pptx"), Buffer.from(bytes));
    const imported = await shell.exec(
      "pptx slides import empty.pptx --source source.pptx --source-slides '[1]' --in-place --json"
    );
    assert.equal(imported.exitCode, 0, imported.stdout + imported.stderr);
    const finalBytes = new Uint8Array(volume.readFileSync("/work/empty.pptx") as Buffer);
    const sdk = await readNotes(finalBytes, {}, context);
    assert.deepEqual(
      sdk.map((note) => [note.slide, note.text]),
      [[2, "Source briefing"]]
    );
    const parts = new Map(
      inspectZip(finalBytes).map((entry) => [
        "/" + entry.name,
        new TextDecoder().decode(entry.payload)
      ])
    );
    assert.ok(parts.get(sdk[0]!.master)!.includes("Source imprint"));
    const result = await shell.exec("pptx notes list empty.pptx --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout).data.notes.map((note: { slide: number; text: string }) => [
        note.slide,
        note.text
      ]),
      [[2, "Source briefing"]]
    );
  } finally {
    await shell.dispose();
  }
});
