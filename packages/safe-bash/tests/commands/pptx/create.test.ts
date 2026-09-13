import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import {
  addSlide,
  createPptxCommandEngine,
  createPresentation,
  getXmlPart,
  duplicateSlides,
  importSlides,
  mergeSlides,
  splitSlides,
  mutateSlides,
  removeSlides,
  mutatePresentationSettings,
  readPresentationSettings,
  readSelectionIndex
} from "pptx";
import { storedArchive } from "../../../../pptx/tests/fixtures/archive.js";
import { readPackage } from "../../../../pptx/src/package-reader.js";
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
      engine: createPptxCommandEngine({ context: engineContext, maxOutputBytes: 262144, maxArgumentBytes: 65536 })
    })
  );
  return { shell, fs, volume };
}

async function fontDeck() {
  const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const xml = `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:v="urn:original:font-metadata" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="v"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Coastal caption"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1" i="1"/></a:pPr><a:r><a:rPr i="1" dirty="0" v:tracking="keep"/><a:t>Cliff &amp; cove</a:t></a:r><a:r><a:rPr sz="900"/><a:t> — unchanged</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const source = await createPresentation({ slides: [{ name: "Coastal survey" }] }, context);
  const archive = await readPackage(source, context);
  return storedArchive(
    archive.names.map((name) => ({
      name: name.slice(1),
      bytes: name === "/ppt/slides/slide1.xml" ? new TextEncoder().encode(xml) : archive.get(name)
    }))
  );
}

test("pptx paragraph formatting flows through a virtual script and byte pipeline", async () => {
  const {shell, volume} = fixture({...context, validationLimits: {...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64}});
  volume.writeFileSync("/work/deck.pptx", await fontDeck());
  volume.writeFileSync("/work/paragraphs.sh", "pptx text paragraphs set deck.pptx --slide 1 --shape 'Coastal caption' --paragraph 1 --alignment right --margin-left 0pt --indent -4pt --space-after 0pt --line-spacing 18pt --direction rtl --numbering lower-roman --tabs '[{\"position\":{\"value\":1,\"unit\":\"in\"},\"alignment\":\"decimal\"}]' --output - | pptx xml get - --part /ppt/slides/slide1.xml --scope slides");
  const out = await shell.exec("sh paragraphs.sh");
  assert.equal(out.exitCode, 0, out.stderr + out.stdout);
  assert.ok(out.stdout.includes('algn="r"'));
  assert.ok(out.stdout.includes('marL="0"'));
  assert.ok(out.stdout.includes('indent="-50800"'));
  assert.ok(out.stdout.includes('rtl="1"'));
  assert.ok(out.stdout.includes('type="romanLcPeriod"'));
  assert.ok(out.stdout.includes('pos="914400"'));
  assert.ok(out.stdout.includes('val="1800"'));
  assert.ok(out.stdout.includes('v:tracking="keep"'));
  assert.ok(out.stdout.includes('sz="900"'));
  assert.ok(out.stdout.includes('Cliff &amp; cove'));
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), await fontDeck());
  const listed = await shell.exec("pptx text paragraphs list deck.pptx --json");
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).data.paragraphs.length, 1);
  const invalid = await shell.exec("pptx text paragraphs set deck.pptx --all --direction sideways --dry-run --json");
  assert.equal(invalid.exitCode, 2);
  assert.equal(JSON.parse(invalid.stdout).operation, "text.paragraphs.set");
});

test("pptx run font edits use scoped shell arguments and preserve unselected XML", async () => {
  const xmlContext = {
    ...context,
    validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 }
  };
  const { shell, volume } = fixture(xmlContext);
  const original = await fontDeck();
  volume.writeFileSync("/work/coastal deck.pptx", original);
  const edited = await shell.exec(
    "pptx text runs set 'coastal deck.pptx' --slide 1 --shape 'Coastal caption' --paragraph 1 --run 1 --font 'Aptos Display' --size 18pt --language en-US --bold false --italic null --underline dbl --strike double --baseline 12 --capitalization small --spacing -1pt --color 123ABC --highlight FFEEDD --output 'styled deck.pptx' --json"
  );
  assert.equal(edited.exitCode, 0, edited.stdout + edited.stderr);
  assert.equal(edited.stderr, "");
  const result = JSON.parse(edited.stdout);
  assert.equal(result.operation, "text.runs.set");
  assert.equal(result.affected, 1);
  assert.equal(result.ok, true);
  const output = new Uint8Array(volume.readFileSync("/work/styled deck.pptx") as Buffer);
  const { xml } = await getXmlPart(output, "/ppt/slides/slide1.xml", xmlContext);
  const tags: { name: string; attributes: Record<string, string> }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) =>
    tags.push({
      name:
        tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main"
          ? `a:${tag.local}`
          : tag.name,
      attributes: Object.fromEntries(
        Object.values(tag.attributes)
          .filter((attribute) => attribute.uri !== "http://www.w3.org/2000/xmlns/")
          .map((attribute) => [attribute.name, attribute.value])
      )
    })
  );
  parser.write(xml).close();
  assert.deepEqual(
    tags.filter((tag) => tag.name === "a:rPr").map((tag) => tag.attributes),
    [
      {
        dirty: "0",
        "v:tracking": "keep",
        b: "0",
        sz: "1800",
        lang: "en-US",
        u: "dbl",
        strike: "dblStrike",
        baseline: "12000",
        cap: "small",
        spc: "-100"
      },
      { sz: "900" }
    ]
  );
  assert.deepEqual(tags.find((tag) => tag.name === "a:defRPr")?.attributes, { b: "1", i: "1" });
  assert.deepEqual(tags.find((tag) => tag.name === "a:latin")?.attributes, {
    typeface: "Aptos Display"
  });
  assert.deepEqual(
    tags.filter((tag) => tag.name === "a:srgbClr").map((tag) => tag.attributes),
    [{ val: "123ABC" }, { val: "FFEEDD" }]
  );
  assert.ok(xml.includes("Cliff &amp; cove"));
  assert.ok(xml.includes(" — unchanged"));
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/coastal deck.pptx") as Buffer),
    original
  );
  const reset = await shell.exec(
    "pptx text runs set 'styled deck.pptx' --slide 1 --shape 'Coastal caption' --paragraph 1 --run 1 --bold null --underline false --strike none --baseline 0 --capitalization none --spacing 0pt --color null --highlight null --output - | pptx xml get - --part /ppt/slides/slide1.xml --scope slides"
  );
  assert.equal(reset.exitCode, 0, reset.stdout + reset.stderr);
  const resetTags: { name: string; attributes: Record<string, string> }[] = [];
  const resetParser = new SaxesParser({ xmlns: true });
  resetParser.on("opentag", (tag) =>
    resetTags.push({
      name:
        tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main"
          ? `a:${tag.local}`
          : tag.name,
      attributes: Object.fromEntries(
        Object.values(tag.attributes)
          .filter((attribute) => attribute.uri !== "http://www.w3.org/2000/xmlns/")
          .map((attribute) => [attribute.name, attribute.value])
      )
    })
  );
  resetParser.write(reset.stdout).close();
  assert.deepEqual(
    resetTags.filter((tag) => tag.name === "a:rPr").map((tag) => tag.attributes),
    [
      {
        dirty: "0",
        "v:tracking": "keep",
        sz: "1800",
        lang: "en-US",
        u: "none",
        strike: "noStrike",
        baseline: "0",
        cap: "none",
        spc: "0"
      },
      { sz: "900" }
    ]
  );
  assert.equal(
    resetTags.some((tag) => tag.name === "a:solidFill" || tag.name === "a:highlight"),
    false
  );
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/styled deck.pptx") as Buffer), output);
});

test("pptx run formatting validates dry runs and rejects invalid values without publication", async () => {
  const { shell, volume } = fixture();
  const original = await fontDeck();
  volume.writeFileSync("/work/deck.pptx", original);
  const ambiguous = await shell.exec(
    "pptx text runs set deck.pptx --slide 1 --shape 'Coastal caption' --bold false --output rejected.pptx --json"
  );
  assert.equal(ambiguous.exitCode, 1, ambiguous.stdout + ambiguous.stderr);
  assert.equal(JSON.parse(ambiguous.stdout).errors[0].code, "ambiguous-selection");
  assert.equal(volume.existsSync("/work/rejected.pptx"), false);
  const dry = await shell.exec(
    "pptx text runs set deck.pptx --slide 1 --shape 'Coastal caption' --bold false --all --dry-run --json"
  );
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.equal(JSON.parse(dry.stdout).data.dryRun, true);
  for (const flags of [
    "--size 0pt",
    "--bold yes",
    "--underline squiggle",
    "--run 0",
    "--color 12345G"
  ]) {
    const result = await shell.exec(
      `pptx text runs set deck.pptx --slide 1 --shape 'Coastal caption' ${flags} --output rejected.pptx --json`
    );
    assert.equal(result.exitCode, 2, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).affected, 0);
    assert.equal(volume.existsSync("/work/rejected.pptx"), false);
  }
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
});

test("pptx run formatting help works before input admission", async () => {
  const { shell, volume } = fixture();
  const help = await shell.exec("pptx text runs set --help");
  assert.equal(help.exitCode, 0, help.stdout + help.stderr);
  assert.equal(help.stderr, "");
  assert.ok(help.stdout.includes("pptx text runs set"));
  assert.ok(help.stdout.includes("--bold"));
  assert.ok(help.stdout.includes("--highlight"));
  assert.deepEqual(volume.readdirSync("/work"), []);
});

const assemblyContext = { ...context,
  archiveLimits: { ...context.archiveLimits, maxMembers: 256, maxTotalBytes: 1048576 },
  xmlLimits: { ...context.xmlLimits, maxBytes: 1048576, maxNodes: 20000 },
  relationshipLimits: { ...context.relationshipLimits, maxBytes: 1048576, maxParts: 4096, maxRelationships: 4096 }
};

function layoutFixture(localKey: string, targetKey: string, duplicate = false) {
  const xmlContext = { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 } };
  const namespace = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const shape = (id: number, key: string, local: boolean) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Caption ${id}"/><p:cNvSpPr/><p:nvPr><p:ph${key}/></p:nvPr></p:nvSpPr><p:spPr>${local ? '<a:xfrm><a:off x="101" y="202"/><a:ext cx="303" cy="404"/></a:xfrm>' : '<a:xfrm><a:off x="901" y="902"/><a:ext cx="903" cy="904"/></a:xfrm>'}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1" sz="1800"/><a:t>${local ? 'Harbor &amp; meadow' : 'Layout prompt'}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
  const localXml = `<p:sld ${namespace}><p:cSld><p:spTree>${group}${shape(2, localKey, true)}<p:sp><p:nvSpPr><p:cNvPr id="9" name="Independent caption"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Keep this local note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const targetXml = `<p:sldLayout ${namespace} type="obj"><p:cSld name="Coastal layout"><p:spTree>${group}${shape(2, targetKey, false)}${duplicate ? shape(3, targetKey, false) : ''}</p:spTree></p:cSld></p:sldLayout>`;
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relations = (entries: readonly (readonly [string, string, string])[]) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const bytes = storedArchive(Object.entries({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>',
    '_rels/.rels': relations([['root', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `<p:presentation ${namespace} xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': relations([['master', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['slide', 'slide', 'slides/slide1.xml']]),
    'ppt/slides/slide1.xml': localXml,
    'ppt/slides/_rels/slide1.xml.rels': relations([['layout', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${namespace} type="blank"><p:cSld name="Initial layout"><p:spTree>${group}</p:spTree></p:cSld></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relations([['master', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/slideLayouts/slideLayout2.xml': targetXml,
    'ppt/slideLayouts/_rels/slideLayout2.xml.rels': relations([['master', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${namespace} xmlns:r="${r}"><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="layout"/><p:sldLayoutId id="2147483650" r:id="coastal"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relations([['layout', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['coastal', 'slideLayout', '../slideLayouts/slideLayout2.xml']])
  }).map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })));
  return { bytes, localXml, targetXml, xmlContext };
}

for (const [description, localKey, targetKey] of [['type and index', '', ' type="obj" idx="0"'], ['index', ' type="body"', ' type="body" idx="0"'], ['type', ' idx="7"', ' type="obj" idx="7"']] as const) {
  test(`pptx layouts apply resolves omitted placeholder ${description}`, async () => {
    const { bytes, localXml, targetXml, xmlContext } = layoutFixture(localKey, targetKey);
    const { shell, volume } = fixture(xmlContext);
    volume.writeFileSync('/work/source deck.pptx', bytes);
    const result = await shell.exec("pptx layouts apply 'source deck.pptx' --slide 1 --layout 'Coastal layout' --placeholder-policy reject-unmatched --output changed.pptx --json");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).operation, 'layouts.apply');
    assert.equal(JSON.parse(result.stdout).affected, 1);
    const changed = new Uint8Array(volume.readFileSync('/work/changed.pptx') as Buffer);
    assert.equal((await getXmlPart(changed, '/ppt/slides/slide1.xml', xmlContext)).xml, localXml);
    assert.equal((await getXmlPart(changed, '/ppt/slideLayouts/slideLayout2.xml', xmlContext)).xml, targetXml);
    assert.ok((await getXmlPart(changed, '/ppt/slides/_rels/slide1.xml.rels', xmlContext)).xml.includes('Target="../slideLayouts/slideLayout2.xml"'));
    assert.deepEqual(new Uint8Array(volume.readFileSync('/work/source deck.pptx') as Buffer), bytes);
  });
}

test('pptx layouts apply keeps unmatched content and validates before publication', async () => {
  const { bytes, xmlContext } = layoutFixture(' type="body" idx="5"', ' type="body" idx="6"');
  const { shell, volume } = fixture(xmlContext);
  volume.writeFileSync('/work/deck.pptx', bytes);
  volume.writeFileSync('/work/keep.pptx', 'Existing destination');
  const rejected = await shell.exec("pptx layouts apply deck.pptx --slide 1 --layout 'Coastal layout' --placeholder-policy reject-unmatched --output keep.pptx --force --json");
  assert.equal(rejected.exitCode, 1, rejected.stdout + rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).affected, 0);
  assert.equal(volume.readFileSync('/work/keep.pptx', 'utf8'), 'Existing destination');
  const omitted = await shell.exec("pptx layouts apply deck.pptx --slide 1 --layout 'Coastal layout' --in-place --json");
  assert.equal(omitted.exitCode, 2, omitted.stdout + omitted.stderr);
  assert.equal(JSON.parse(omitted.stdout).affected, 0);
  const dry = await shell.exec("pptx layouts apply deck.pptx --slide 1 --layout 'Coastal layout' --placeholder-policy type-index --dry-run --json");
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync('/work/deck.pptx') as Buffer), bytes);
  const kept = await shell.exec("pptx layouts apply deck.pptx --slide 1 --layout 'Coastal layout' --placeholder-policy type-index --in-place --json");
  assert.equal(kept.exitCode, 0, kept.stdout + kept.stderr);
  const xml = (await getXmlPart(new Uint8Array(volume.readFileSync('/work/deck.pptx') as Buffer), '/ppt/slides/slide1.xml', xmlContext)).xml;
  assert.ok(xml.includes('Harbor &amp; meadow'));
  assert.ok(xml.includes('Keep this local note'));
  assert.ok(xml.includes('<a:rPr b="1" sz="1800"/>'));
  assert.ok(xml.includes('<a:off x="101" y="202"/>'));
});

test('pptx layouts apply rejects duplicate normalized keys without creating output', async () => {
  const { bytes, xmlContext } = layoutFixture('', '', true);
  const { shell, volume } = fixture(xmlContext);
  volume.writeFileSync('/work/deck.pptx', bytes);
  const result = await shell.exec("pptx layouts apply deck.pptx --slide 1 --layout 'Coastal layout' --placeholder-policy type-index --output out.pptx --json");
  assert.equal(result.exitCode, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).affected, 0);
  assert.equal(volume.existsSync('/work/out.pptx'), false);
  assert.deepEqual(new Uint8Array(volume.readFileSync('/work/deck.pptx') as Buffer), bytes);
});

test('pptx slides add inherits placeholder geometry and formatting without copying prompts', async () => {
  const { bytes, targetXml, xmlContext } = layoutFixture('', '');
  const { shell, volume } = fixture(xmlContext);
  volume.writeFileSync('/work/deck.pptx', bytes);
  const result = await shell.exec(`pptx slides add deck.pptx --layout 'Coastal layout' --placeholders-json '[{"type":"obj","index":0,"text":"Morning survey"}]' --output out.pptx --json`);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).affected, 1);
  const output = new Uint8Array(volume.readFileSync('/work/out.pptx') as Buffer);
  const index = await readSelectionIndex(output, context);
  assert.equal(index.slides.length, 2);
  const xml = (await getXmlPart(output, index.slides[1]!.part, xmlContext)).xml;
  assert.ok(xml.includes('Morning survey'));
  assert.ok(xml.includes('<p:ph/>'));
  assert.ok(xml.includes('<p:spPr/>'));
  assert.equal(xml.includes('Layout prompt'), false);
  assert.equal(xml.includes('<a:xfrm>'), false);
  assert.equal(xml.includes('sz="1800"'), false);
  assert.equal((await getXmlPart(output, '/ppt/slideLayouts/slideLayout2.xml', xmlContext)).xml, targetXml);
  assert.deepEqual(new Uint8Array(volume.readFileSync('/work/deck.pptx') as Buffer), bytes);
});

test("pptx shared master rename reports dependent slides and retains slide content", async () => {
  const xmlContext = { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 } };
  const { shell, volume } = fixture(xmlContext);
  const original = await createPresentation({ slides: [
    { name: "Harbor", shapes: [{ name: "Local caption", x: 10, y: 20, width: 300, height: 100, text: "Local wording" }] },
    { name: "Island" }
  ] }, context);
  volume.writeFileSync("/work/input deck.pptx", original);
  const result = await shell.exec("pptx masters set 'input deck.pptx' --scope shared --part /ppt/slideMasters/slideMaster1.xml --name 'Coastal τ' --output result.pptx --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operation, "masters.set");
  assert.equal(envelope.affected, 1);
  assert.deepEqual(envelope.data.affectedSlides, [1, 2]);
  const output = new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer);
  const index = await readSelectionIndex(output, context);
  const masterXml = await getXmlPart(output, "/ppt/slideMasters/slideMaster1.xml", xmlContext);
  assert.ok(masterXml.xml.includes('name="Coastal τ"'));
  assert.deepEqual(index.slides.map(slide => slide.name), ["Harbor", "Island"]);
  const local = await shell.exec("pptx xml get result.pptx --part /ppt/slides/slide1.xml");
  const initial = await shell.exec("pptx xml get 'input deck.pptx' --part /ppt/slides/slide1.xml");
  assert.equal(local.exitCode, 0, local.stderr);
  assert.equal(initial.exitCode, 0, initial.stderr);
  assert.equal(local.stdout, initial.stdout);
  assert.ok(local.stdout.includes("Local wording"));
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/input deck.pptx") as Buffer), original);
  const dry = await shell.exec("pptx masters set result.pptx --scope shared --part /ppt/slideMasters/slideMaster1.xml --name Preview --in-place --dry-run --json");
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).data.outputs, []);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer), output);
  const rejected = await shell.exec("pptx masters set result.pptx --part /ppt/slideMasters/slideMaster1.xml --name Rejected --in-place --json");
  assert.equal(rejected.exitCode, 2, rejected.stdout + rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).affected, 0);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer), output);
});

test("pptx creates master content and reassigns layouts without modifying a shared theme", async () => {
  const xmlContext = { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 } };
  const { shell, volume } = fixture(xmlContext);
  const original = await createPresentation({ slides: [{ name: "Dawn" }, { name: "Dusk" }] }, context);
  volume.writeFileSync("/work/deck.pptx", original);
  const created = await shell.exec("pptx masters add deck.pptx --scope shared --name Lagoon --theme /ppt/theme/theme1.xml --output created.pptx --json");
  assert.equal(created.exitCode, 0, created.stdout + created.stderr);
  assert.deepEqual(JSON.parse(created.stdout).data.affectedSlides, []);
  const index = await readSelectionIndex(new Uint8Array(volume.readFileSync("/work/created.pptx") as Buffer), context);
  const master = index.parts.find(part => part.scope === "masters" && part.part !== "/ppt/slideMasters/slideMaster1.xml");
  assert.ok(master);
  assert.equal(index.parts.filter(part => part.scope === "masters").length, 2);
  const shape = await shell.exec(`pptx shapes add created.pptx --scope masters --part ${master.part} --kind text-box --name 'Shared caption' --left 100emu --top 200emu --width 3000emu --height 1000emu --text 'Tidal survey' --in-place --json`);
  assert.equal(shape.exitCode, 0, shape.stdout + shape.stderr);
  const background = await shell.exec(`pptx backgrounds set created.pptx --scope masters --part ${master.part} --kind solid --color AABBCC --in-place --json`);
  assert.equal(background.exitCode, 0, background.stdout + background.stderr);
  const edited = await shell.exec(`pptx shapes set created.pptx --scope masters --part ${master.part} --shape 'Shared caption' --text 'Measured τ' --in-place --json`);
  assert.equal(edited.exitCode, 0, edited.stdout + edited.stderr);
  const xml = await shell.exec(`pptx xml get created.pptx --part ${master.part} --scope masters`);
  assert.equal(xml.exitCode, 0, xml.stderr);
  assert.ok(xml.stdout.includes("Measured τ"));
  assert.ok(xml.stdout.includes('val="AABBCC"'));
  assert.equal(xml.stdout.includes("Tidal survey"), false);
  const associated = await shell.exec(`pptx layouts set created.pptx --scope shared --part /ppt/slideLayouts/slideLayout1.xml --master ${master.part} --output associated.pptx --json`);
  assert.equal(associated.exitCode, 0, associated.stdout + associated.stderr);
  assert.deepEqual(JSON.parse(associated.stdout).data.affectedSlides, [1, 2]);
  const relationship = await shell.exec("pptx xml get associated.pptx --part /ppt/slideLayouts/_rels/slideLayout1.xml.rels --scope shared");
  assert.equal(relationship.exitCode, 0, relationship.stderr);
  assert.ok(relationship.stdout.includes(master.part.slice(master.part.lastIndexOf("/") + 1)));
  const themeBefore = await shell.exec("pptx xml get deck.pptx --part /ppt/theme/theme1.xml --scope shared");
  const themeAfter = await shell.exec("pptx xml get associated.pptx --part /ppt/theme/theme1.xml --scope shared");
  assert.equal(themeBefore.exitCode, 0, themeBefore.stderr);
  assert.equal(themeAfter.exitCode, 0, themeAfter.stderr);
  assert.equal(themeAfter.stdout, themeBefore.stdout);
  const piped = await shell.exec(`pptx masters set associated.pptx --scope shared --part ${master.part} --name Estuary --output - | pptx masters list - --json`);
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.equal(JSON.parse(piped.stdout).operation, "masters.list");
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
});

test("pptx master text safely encodes XML closing delimiters", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await createPresentation({}, context));
  const result = await shell.exec("pptx masters add deck.pptx --scope masters --name Delimiters --text 'A]]>B' --in-place --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const xml = await getXmlPart(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), "/ppt/slideMasters/slideMaster2.xml", { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 } });
  assert.ok(xml.xml.includes("A]]&gt;B"));
});

test("pptx master geometry updates preserve unspecified coordinates and support inheritance reset", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await createPresentation({}, context));
  const add = await shell.exec("pptx shapes add deck.pptx --scope masters --part /ppt/slideMasters/slideMaster1.xml --kind text-box --name Caption --left 20emu --top 30emu --width 400emu --height 500emu --text Retained --in-place --json");
  assert.equal(add.exitCode, 0, add.stdout + add.stderr);
  const resize = await shell.exec("pptx shapes set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster1.xml --shape Caption --width 600emu --in-place --json");
  assert.equal(resize.exitCode, 0, resize.stdout + resize.stderr);
  const solid = await shell.exec("pptx backgrounds set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster1.xml --kind solid --color AABBCC --in-place --json");
  assert.equal(solid.exitCode, 0, solid.stdout + solid.stderr);
  const reset = await shell.exec("pptx backgrounds set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster1.xml --kind inherit --in-place --json");
  assert.equal(reset.exitCode, 0, reset.stdout + reset.stderr);
  const xml = await getXmlPart(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), "/ppt/slideMasters/slideMaster1.xml", { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 } });
  assert.ok(xml.xml.includes('x="20" y="30"'));
  assert.ok(xml.xml.includes('cx="600" cy="500"'));
  assert.ok(xml.xml.includes("Retained"));
  assert.equal(xml.xml.includes("<p:bg"), false);
  assert.deepEqual(JSON.parse(reset.stdout).data.affectedSlides, []);
});

test("pptx master part selectors remain exact when another master name resembles a URI", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await createPresentation({}, context));
  const added = await shell.exec("pptx masters add deck.pptx --scope masters --name /ppt/slideMasters/slideMaster1.xml --in-place --json");
  assert.equal(added.exitCode, 0, added.stdout + added.stderr);
  const edited = await shell.exec("pptx masters set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster1.xml --name Primary --in-place --json");
  assert.equal(edited.exitCode, 0, edited.stdout + edited.stderr);
  const listed = await shell.exec("pptx masters list deck.pptx --json");
  assert.equal(listed.exitCode, 0, listed.stdout + listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).data.records.map((record: { name: string }) => record.name), ["Primary", "/ppt/slideMasters/slideMaster1.xml"]);
});

for (const names of [["3", "Other"], ["Caption", "2"]]) {
  test(`pptx master text selects exact shape names despite numeric identities ${names.join(" / ")}`, async () => {
    const { shell, volume } = fixture();
    volume.writeFileSync("/work/deck.pptx", await createPresentation({}, context));
    for (const name of names) {
      const added = await shell.exec(`pptx shapes add deck.pptx --scope masters --part /ppt/slideMasters/slideMaster1.xml --kind text-box --name '${name}' --left 0emu --top 0emu --width 100emu --height 100emu --text Original --in-place --json`);
      assert.equal(added.exitCode, 0, added.stdout + added.stderr);
    }
    const result = await shell.exec(`pptx shapes set deck.pptx --scope masters --part /ppt/slideMasters/slideMaster1.xml --shape '${names[0]}' --text Changed --in-place --json`);
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const xml = await getXmlPart(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), "/ppt/slideMasters/slideMaster1.xml", { ...context, validationLimits: { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 } });
    assert.ok(xml.xml.includes("Changed"));
    assert.ok(xml.xml.includes("Original"));
  });
}

test("pptx settings edit through shell and public SDK with canvas-only defaults", async () => {
  const { shell, volume } = fixture();
  const original = await createPresentation({ slides: [{ shapes: [{ x: 20, y: 30, width: 400, height: 500, text: "Independent canvas" }] }] }, context);
  volume.writeFileSync("/work/input deck.pptx", original);
  const result = await shell.exec("pptx settings set 'input deck.pptx' --width 10in --height 5in --notes-orientation landscape --slide-number-start -2 --loop true --show-type window --output result.pptx --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const bytes = new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer);
  assert.deepEqual(bytes, await mutatePresentationSettings(original, { width: 9144000, height: 4572000, notesOrientation: "landscape", slideNumberStart: -2, loop: true, showType: "window" }, context));
  const settings = await readPresentationSettings(bytes, context);
  assert.equal(settings.width, 9144000);
  assert.equal(settings.height, 4572000);
  assert.equal(settings.slideNumberStart, -2);
  assert.equal(settings.notesOrientation, "landscape");
  const piped = await shell.exec("pptx settings set result.pptx --orientation portrait --output - | pptx settings get - --json");
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.equal(JSON.parse(piped.stdout).data.settings.width, 4572000);
  assert.equal(JSON.parse(piped.stdout).data.settings.height, 9144000);
  const scaled = await shell.exec("pptx settings set result.pptx --width 20in --height 10in --scale-content true --output scaled.pptx --json");
  assert.equal(scaled.exitCode, 0, scaled.stdout + scaled.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/scaled.pptx") as Buffer), await mutatePresentationSettings(bytes, { width: 18288000, height: 9144000, scaleContent: true }, context));
  const dry = await shell.exec("pptx settings set result.pptx --loop false --in-place --dry-run --json");
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer), bytes);
  const unsupported = await shell.exec("pptx settings set result.pptx --width 12in --scale-content --in-place --json");
  assert.equal(unsupported.exitCode, 2, unsupported.stdout + unsupported.stderr);
  assert.equal(JSON.parse(unsupported.stdout).errors[0].code, "invalid-value");
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer), bytes);
});
test("pptx merges and splits through shell and byte SDK with matching packages", async () => {
  const { shell, volume } = fixture(assemblyContext);
  const original = await createPresentation({ slides: [{ name: "Spring" }, { name: "Autumn" }] }, context);
  const destination = await createPresentation({}, context);
  volume.writeFileSync("/work/source.pptx", original);
  volume.writeFileSync("/work/input.pptx", destination);
  volume.mkdirSync("/work/out");
  const merged = await shell.exec(`pptx slides merge input.pptx --sources '[{"vfsPath":"source.pptx"}]' --source-slides '[2,1]' --theme-policy source --output merged.pptx --json`);
  assert.equal(merged.exitCode, 0, merged.stdout + merged.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/merged.pptx") as Buffer), await mergeSlides(destination, [original], { sourceSlides: [2,1], themePolicy: "source" }, assemblyContext));
  const split = await shell.exec("pptx slides split source.pptx --slides '[2,1]' --output-dir out --allow-partial-output --json");
  assert.equal(split.exitCode, 0, split.stdout + split.stderr);
  const outputs = JSON.parse(split.stdout).data.outputs;
  assert.deepEqual(outputs.map((item: {path: string}) => item.path), ["out/slide-000001.pptx", "out/slide-000002.pptx"]);
  const sdk = await splitSlides(original, { slides: [2,1] }, assemblyContext);
  for (const output of sdk) assert.deepEqual(new Uint8Array(volume.readFileSync(`/work/out/${output.name}`) as Buffer), output.bytes);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer), original);
});

test("pptx split preflights every output and refuses aliases before writes", async () => {
  const { shell, volume } = fixture(assemblyContext);
  const original = await createPresentation({ slides: [{ name: "East" }, { name: "West" }] }, context);
  volume.writeFileSync("/work/input.pptx", original);
  volume.mkdirSync("/work/out");
  volume.linkSync("/work/input.pptx", "/work/out/slide-000002.pptx");
  const result = await shell.exec("pptx slides split input.pptx --slides '[1,2]' --output-dir out --force --allow-partial-output --json");
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).affected, 0);
  assert.equal(volume.existsSync("/work/out/slide-000001.pptx"), false);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/input.pptx") as Buffer), original);
});

test("pptx split reports completed output after conditional publication failure", async () => {
  const { shell, fs, volume } = fixture(assemblyContext);
  const original = await createPresentation({ slides: [{ name: "Copper" }, { name: "Silver" }] }, context);
  volume.writeFileSync("/work/input.pptx", original);
  volume.mkdirSync("/work/out");
  const write = fs.writeFileConditional!;
  fs.writeFileConditional = async (path, bytes, options) => {
    if (path.endsWith("slide-000002.pptx")) throw new FsError("EIO");
    return write(path, bytes, options);
  };
  const result = await shell.exec("pptx slides split input.pptx --slides '[2,1]' --output-dir out --allow-partial-output --json");
  assert.equal(result.exitCode, 3, result.stdout + result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.affected, 1);
  assert.deepEqual(envelope.data.outputs.map((item: {path:string}) => item.path), ["out/slide-000001.pptx"]);
  assert.equal(envelope.data.sources[0].sourceSlide, 2);
  assert.equal(volume.existsSync("/work/out/slide-000002.pptx"), false);
});

test("pptx split requires partial authorization and preserves existing output conflicts", async () => {
  const { shell, volume } = fixture(assemblyContext);
  const original = await createPresentation({ slides: [{ name: "North" }, { name: "South" }] }, context);
  volume.writeFileSync("/work/input.pptx", original);
  volume.mkdirSync("/work/out");
  const unavailable = await shell.exec("pptx slides split input.pptx --slides '[1,2]' --output-dir out --json");
  assert.equal(unavailable.exitCode, 1, unavailable.stdout + unavailable.stderr);
  assert.equal(JSON.parse(unavailable.stdout).errors[0].code, "publication-unsupported");
  volume.writeFileSync("/work/out/slide-000002.pptx", "retained");
  const conflict = await shell.exec("pptx slides split input.pptx --slides '[1,2]' --output-dir out --allow-partial-output --json");
  assert.equal(conflict.exitCode, 3, conflict.stdout + conflict.stderr);
  assert.equal(JSON.parse(conflict.stdout).data, null);
  assert.equal(volume.existsSync("/work/out/slide-000001.pptx"), false);
  assert.equal(volume.readFileSync("/work/out/slide-000002.pptx", "utf8"), "retained");
});

test("pptx imports ordered slides through SDK and shell with isolated source bytes", async () => {
  const { shell, volume } = fixture();
  const source = await createPresentation({ slides: [{ name: "Lagoon" }, { name: "Beacon" }] }, context);
  const destination = await createPresentation({ slides: [{ name: "Pier" }] }, context);
  volume.writeFileSync("/work/source deck.pptx", source);
  volume.writeFileSync("/work/destination.pptx", destination);
  const result = await shell.exec("pptx slides import destination.pptx --source 'source deck.pptx' --source-slides '[2,1]' --position 1 --output result.pptx --json");
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).operation, "slides.import");
  assert.equal(JSON.parse(result.stdout).affected, 2);
  const output = new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer);
  assert.deepEqual(output, await importSlides(destination, source, { sourceSlides: [2,1], position: 1 }, context));
  assert.deepEqual((await readSelectionIndex(output, context)).slides.map(slide => slide.name), ["Beacon", "Lagoon", "Pier"]);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source deck.pptx") as Buffer), source);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/destination.pptx") as Buffer), destination);
  const dry = await shell.exec("pptx slides import destination.pptx --source 'source deck.pptx' --source-slides '[1]' --in-place --dry-run --json");
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).data.outputs, []);
  const pipeline = await shell.exec("pptx slides import destination.pptx --source 'source deck.pptx' --source-slides '[1]' --output - | pptx inspect - --json");
  assert.equal(pipeline.exitCode, 0, pipeline.stdout + pipeline.stderr);
  assert.deepEqual(JSON.parse(pipeline.stdout).data.records.map((record: { name: string }) => record.name), ["Pier", "Lagoon"]);
});

test("pptx import never overwrites an aliased source under force", async () => {
  const { shell, volume } = fixture();
  const source = await createPresentation({ slides: [{ name: "Source" }] }, context);
  volume.writeFileSync("/work/source.pptx", source);
  volume.writeFileSync("/work/destination.pptx", await createPresentation({}, context));
  volume.linkSync("/work/source.pptx", "/work/alias.pptx");
  for (const output of ["source.pptx", "./source.pptx", "alias.pptx"]) {
    const result = await shell.exec(`pptx slides import destination.pptx --source source.pptx --source-slides '[1]' --output ${output} --force --json`);
    assert.notEqual(result.exitCode, 0, result.stdout + result.stderr);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer), source);
  }
  const same = await shell.exec("pptx slides import source.pptx --source ./source.pptx --source-slides '[1]' --in-place --json");
  assert.notEqual(same.exitCode, 0, same.stdout + same.stderr);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source.pptx") as Buffer), source);
});

test("pptx slide duplication publishes fresh identities and preserves its source", async () => {
  const { shell, volume } = fixture();
  const source = await createPresentation({ slides: [
    { name: "Estuary", shapes: [{ name: "Caption", x: 10, y: 20, width: 300, height: 100, text: "Tide survey" }] },
    { name: "Headland" }
  ] }, context);
  volume.writeFileSync("/work/source deck.pptx", source);
  const result = await shell.exec(
    "pptx slides duplicate 'source deck.pptx' --slide 1 --position 2 --output 'copied deck.pptx' --json"
  );
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).operation, "slides.duplicate");
  assert.equal(JSON.parse(result.stdout).affected, 1);
  const output = new Uint8Array(volume.readFileSync("/work/copied deck.pptx") as Buffer);
  assert.deepEqual(output, await duplicateSlides(source, {
    selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
    position: 2
  }, context));
  const index = await readSelectionIndex(output, context);
  assert.deepEqual(index.slides.map(slide => [slide.id, slide.name]), [
    ["256", "Estuary"], ["258", "Estuary"], ["257", "Headland"]
  ]);
  assert.notEqual(index.slides[0]!.part, index.slides[1]!.part);
  const inspected = await shell.exec("pptx inspect 'copied deck.pptx' --slide 2 --shape Caption --json");
  assert.equal(inspected.exitCode, 0, inspected.stdout + inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).data.records[0].name, "Caption");
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source deck.pptx") as Buffer), source);
});

test("pptx slide duplication keeps dry runs and invalid selections from publishing", async () => {
  const { shell, volume } = fixture();
  const source = await createPresentation({ slides: [{ name: "Soundings" }] }, context);
  volume.writeFileSync("/work/deck.pptx", source);
  const dry = await shell.exec("pptx slides duplicate deck.pptx --slide 1 --position 2 --in-place --dry-run --json");
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).data.outputs, []);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), source);
  for (const [flags, status] of [["--slide 1 --position 3", 2], ["--slide 2 --position 2", 1]] as const) {
    const result = await shell.exec(`pptx slides duplicate deck.pptx ${flags} --output rejected.pptx --json`);
    assert.equal(result.exitCode, status, result.stdout + result.stderr);
    assert.equal(volume.existsSync("/work/rejected.pptx"), false);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), source);
  }
  const piped = await shell.exec("pptx slides duplicate deck.pptx --slide 1 --position 1 --output - | pptx inspect - --json");
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.deepEqual(JSON.parse(piped.stdout).data.records.map((record: { id: string; name: string }) => [record.id, record.name]), [
    ["257", "Soundings"], ["256", "Soundings"]
  ]);
  const inPlace = await shell.exec("pptx slides duplicate deck.pptx --slide 1 --position 2 --in-place --json");
  assert.equal(inPlace.exitCode, 0, inPlace.stdout + inPlace.stderr);
  assert.deepEqual(
    (await readSelectionIndex(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), context)).slides.map(slide => slide.id),
    ["256", "257"]
  );
});

test("pptx slide removal uses explicit VFS publication and matches SDK identity", async () => {
  const { shell, volume } = fixture();
  const source = await createPresentation(
    { slides: [{ name: "First" }, { name: "Retained" }, { name: "Last" }] },
    context
  );
  volume.writeFileSync("/work/source deck.pptx", source);
  const selection = [
    { kind: "slide", id: "258" },
    { kind: "slide", id: "256" }
  ] as const;
  const removed = await shell.exec(
    `pptx slides remove 'source deck.pptx' --selection-json '${JSON.stringify(selection)}' --output 'remaining deck.pptx' --json`
  );
  assert.equal(removed.exitCode, 0, removed.stdout + removed.stderr);
  const output = new Uint8Array(volume.readFileSync("/work/remaining deck.pptx") as Buffer);
  assert.deepEqual(output, await removeSlides(source, { selection }, context));
  assert.deepEqual(
    JSON.parse(removed.stdout).locations.map((location: { objectId: string }) => location.objectId),
    ["258", "256"]
  );
  assert.deepEqual(
    (await readSelectionIndex(output, context)).slides.map((slide) => [slide.id, slide.name]),
    [["257", "Retained"]]
  );
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/source deck.pptx") as Buffer), source);
  const dry = await shell.exec(
    "pptx slides remove 'remaining deck.pptx' --all --in-place --dry-run --json"
  );
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/remaining deck.pptx") as Buffer),
    output
  );
  const piped = await shell.exec(
    "pptx slides remove 'remaining deck.pptx' --all --output - | pptx inspect - --json"
  );
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.equal(JSON.parse(piped.stdout).data.inventory.counts.slides, 0);
  assert.equal(JSON.parse(piped.stdout).data.inventory.counts.themes, 1);
  const inPlace = await shell.exec(
    "pptx slides remove 'remaining deck.pptx' --all --in-place --json"
  );
  assert.equal(inPlace.exitCode, 0, inPlace.stdout + inPlace.stderr);
  assert.equal(
    (
      await readSelectionIndex(
        new Uint8Array(volume.readFileSync("/work/remaining deck.pptx") as Buffer),
        context
      )
    ).slides.length,
    0
  );
});

test("pptx creation publishes into explicit memfs and matches the SDK package", async () => {
  const { shell, volume } = fixture();
  const slides = [
    {
      name: "Rain",
      shapes: [
        { name: "Caption", x: 1000, y: 2000, width: 3000000, height: 400000, text: "Rain & river" }
      ]
    }
  ];
  const result = await shell.exec(
    `pptx create --kind ppsx --width 10in --slides-json '${JSON.stringify(slides)}' --output 'field show.ppsx' --json`
  );
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  const bytes = new Uint8Array(volume.readFileSync("/work/field show.ppsx") as Buffer);
  assert.deepEqual(
    bytes,
    await createPresentation({ kind: "ppsx", width: 9144000, slides }, context)
  );
  assert.deepEqual(JSON.parse(result.stdout).data.outputs, [
    {
      path: "field show.ppsx",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }
  ]);
  const inspect = await shell.exec(
    "pptx inspect 'field show.ppsx' --slide 1 --shape Caption --json"
  );
  assert.equal(inspect.exitCode, 0, inspect.stdout + inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).data.records[0].name, "Caption");
});

for (const mode of ["existing", "dry-run", "unsupported", "race", "symlink"] as const) {
  test(`pptx creation protects the destination during ${mode}`, async () => {
    const { shell, fs, volume } = fixture();
    volume.writeFileSync("/work/deck.pptx", "existing bytes");
    if (mode === "unsupported")
      fs.capabilitiesFor = async () => ({ ...fs.capabilities, atomicFileMutation: false });
    if (mode === "race")
      fs.writeFileConditional = async () => {
        throw new FsError("EAGAIN");
      };
    if (mode === "symlink") volume.symlinkSync("/work/deck.pptx", "/work/link.pptx");
    const destination = mode === "symlink" ? "link.pptx" : "deck.pptx";
    const result = await shell.exec(
      `pptx create --output ${destination} ${mode === "existing" ? "" : "--force"} ${mode === "dry-run" ? "--dry-run" : ""} --json`
    );
    assert.equal(
      result.exitCode,
      mode === "dry-run" ? 0 : mode === "unsupported" || mode === "race" ? 1 : 3,
      result.stdout + result.stderr
    );
    assert.equal(volume.readFileSync("/work/deck.pptx", "utf8"), "existing bytes");
    if (mode === "dry-run") assert.deepEqual(JSON.parse(result.stdout).data.outputs, []);
  });
}

test("pptx creation force replaces only the explicit destination and streams clean package bytes", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", "old");
  volume.writeFileSync("/work/keep.txt", "keep");
  const published = await shell.exec("pptx create --output deck.pptx --force --json");
  assert.equal(published.exitCode, 0, published.stdout + published.stderr);
  const piped = await shell.exec("pptx create --output - | pptx inspect - --json");
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.equal(piped.stderr, "");
  assert.deepEqual(JSON.parse(piped.stdout).data.inventory.counts, {
    slides: 0,
    masters: 1,
    layouts: 1,
    themes: 1,
    slideShapes: 0,
    parts: 6,
    media: 0
  });
  assert.equal(volume.readFileSync("/work/keep.txt", "utf8"), "keep");
});

for (const position of [1, 2, 3]) {
  test(`pptx slides add publishes at boundary ${position} through the same SDK behavior`, async () => {
    const { shell, volume } = fixture();
    const original = await createPresentation(
      { slides: [{ name: "Start" }, { name: "End" }] },
      context
    );
    volume.writeFileSync("/work/source deck.pptx", original);
    const result = await shell.exec(
      `pptx slides add 'source deck.pptx' --layout Blank --position ${position} --name 'River survey' --output 'new deck.pptx' --json`
    );
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).operation, "slides.add");
    const output = new Uint8Array(volume.readFileSync("/work/new deck.pptx") as Buffer);
    assert.deepEqual(
      output,
      await addSlide(original, { layout: "Blank", position, name: "River survey" }, context)
    );
    const names = (await readSelectionIndex(output, context)).slides.map((slide) => slide.name);
    const expected = ["Start", "End"];
    expected.splice(position - 1, 0, "River survey");
    assert.deepEqual(names, expected);
    assert.deepEqual(
      new Uint8Array(volume.readFileSync("/work/source deck.pptx") as Buffer),
      original
    );
  });
}

test("pptx slides add supports in-place editing, dry runs and binary pipelines", async () => {
  const { shell, volume } = fixture();
  const original = await createPresentation({}, context);
  volume.writeFileSync("/work/deck.pptx", original);
  const dry = await shell.exec(
    "pptx slides add deck.pptx --layout Blank --in-place --dry-run --json"
  );
  assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout).data.outputs, []);
  assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
  const changed = await shell.exec(
    "pptx slides add deck.pptx --layout Blank --name 'First slide' --in-place --json"
  );
  assert.equal(changed.exitCode, 0, changed.stdout + changed.stderr);
  const piped = await shell.exec(
    "pptx slides add deck.pptx --layout Blank --name Second --output - | pptx inspect - --json"
  );
  assert.equal(piped.exitCode, 0, piped.stdout + piped.stderr);
  assert.equal(piped.stderr, "");
  assert.deepEqual(
    JSON.parse(piped.stdout).data.records.map((record: { name: string }) => record.name),
    ["First slide", "Second"]
  );
});

test("pptx slides add rejects missing placeholders and out-of-range positions without publication", async () => {
  for (const options of ["--position 2", "--title 'No matching heading'", "--layout Missing"]) {
    const { shell, volume } = fixture();
    const original = await createPresentation({}, context);
    volume.writeFileSync("/work/deck.pptx", original);
    const result = await shell.exec(
      `pptx slides add deck.pptx ${options.startsWith("--layout") ? "" : "--layout Blank"} ${options} --output out.pptx --json`
    );
    assert.equal(
      result.exitCode,
      options.startsWith("--position") ? 2 : 1,
      result.stdout + result.stderr
    );
    assert.equal(volume.existsSync("/work/out.pptx"), false);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), original);
  }
});

test("pptx slide mutations preserve identity through ordered JSON selection and shell publication", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync(
    "/work/slides.pptx",
    await createPresentation(
      { slides: [{ name: "Same" }, { name: "Second" }, { name: "Same" }, { name: "Fourth" }] },
      context
    )
  );
  const source = new Uint8Array(volume.readFileSync("/work/slides.pptx") as Buffer);
  const selection = [
    { kind: "slide", position: { coordinateSystem: "one-based", value: 4 } },
    { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } }
  ] as const;
  const move = await shell.exec(
    `pptx slides move slides.pptx --selection-json '${JSON.stringify(selection)}' --position 1 --in-place --json`
  );
  assert.equal(move.exitCode, 0, move.stdout + move.stderr);
  assert.equal(JSON.parse(move.stdout).affected, 2);
  assert.deepEqual(
    new Uint8Array(volume.readFileSync("/work/slides.pptx") as Buffer),
    await mutateSlides(source, { selection, position: 1 }, context)
  );
  const listed = await shell.exec("pptx inspect slides.pptx --json");
  assert.equal(listed.exitCode, 0, listed.stdout + listed.stderr);
  assert.deepEqual(
    JSON.parse(listed.stdout).data.records.map((record: { id: string; name: string }) => [
      record.id,
      record.name
    ]),
    [
      ["259", "Fourth"],
      ["257", "Second"],
      ["256", "Same"],
      ["258", "Same"]
    ]
  );
  const set = await shell.exec(
    "pptx slides set slides.pptx --slide 1 --name Same --hidden true --in-place --json"
  );
  assert.equal(set.exitCode, 0, set.stdout + set.stderr);
  const shown = await shell.exec("pptx inspect slides.pptx --json");
  assert.equal(shown.exitCode, 0, shown.stdout + shown.stderr);
  assert.deepEqual(
    JSON.parse(shown.stdout).data.records.map((record: { id: string }) => record.id),
    ["259", "257", "256", "258"]
  );
  assert.equal(JSON.parse(shown.stdout).data.inventory.slides[0].show.effective, false);
  const show = await shell.exec(
    "pptx slides set slides.pptx --slide 1 --hidden false --output - | pptx inspect - --json"
  );
  assert.equal(show.exitCode, 0, show.stdout + show.stderr);
  assert.equal(JSON.parse(show.stdout).data.inventory.slides[0].show.effective, true);
});

test("pptx sections and shows preserve quoted empty names and shell pipeline bytes", async () => {
  const { shell, volume } = fixture();
  volume.writeFileSync("/work/deck.pptx", await createPresentation({ slides: [{name: "One"}, {name: "Two"}] }, context));
  const section = await shell.exec("pptx sections add deck.pptx --name '' --slides '[1,2]' --in-place --json");
  assert.equal(section.exitCode, 0, section.stdout + section.stderr);
  const list = await shell.exec("pptx sections list deck.pptx --json");
  assert.equal(list.exitCode, 0, list.stdout + list.stderr);
  const record = JSON.parse(list.stdout).data.records[0];
  assert.equal(record.name, "");
  assert.deepEqual(record.slides, [1,2]);
  const renamed = await shell.exec(`pptx sections set deck.pptx --select '${record.token}' --name 'Field notes' --in-place --json`);
  assert.equal(renamed.exitCode, 0, renamed.stdout + renamed.stderr);
  const shown = await shell.exec("pptx shows add deck.pptx --name 'Route' --slides '[2,1]' --output - | pptx shows get - --json");
  assert.equal(shown.exitCode, 0, shown.stdout + shown.stderr);
  assert.deepEqual(JSON.parse(shown.stdout).data.records.map((item: {name:string; slides:number[]}) => ({name:item.name,slides:item.slides})), [{name:"Route",slides:[2,1]}]);
  const unchanged = await shell.exec("pptx shows list deck.pptx --json");
  assert.deepEqual(JSON.parse(unchanged.stdout).data.records, []);
});
