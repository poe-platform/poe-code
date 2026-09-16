import assert from "node:assert/strict";
import test, { before, after, mock } from "node:test";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { inspectZip } from "../../../../pptx/tests/zip-reader.js";
import { parseXmlPart, type XmlElement } from "../../../../pptx/src/xml.js";
import { writePackageArchive } from "../../../../pptx/src/package-writer.js";
import * as pptx from "pptx";
import { createPptxCommandEngine, createPresentation } from "pptx";
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

const bindings = [
  {
    kind: "text",
    name: "coast",
    scope: "slides",
    slide: 1,
    cardinality: "all",
    text: "海 🐚 {literal} $(echo untouched)"
  }
] as const;

async function originalDeck() {
  return createPresentation(
    {
      slides: [
        {
          shapes: [
            {
              name: "Caption",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              text: "{{coast}} / {{coast}} / {literal}"
            }
          ]
        },
        {
          shapes: [
            { name: "Other caption", x: 0, y: 0, width: 100, height: 100, text: "{{coast}}" }
          ]
        }
      ]
    },
    context
  );
}

test("typed text bindings survive shell quoting and preserve explicit slide scope", async () => {
  const { shell, volume } = fixture();
  const input = await originalDeck();
  volume.writeFileSync("/work/海 input.pptx", input);
  volume.writeFileSync(
    "/work/apply.sh",
    `pptx template apply '海 input.pptx' --data-json '${JSON.stringify(bindings)}' --output 'bound deck.pptx' --json`
  );
  try {
    const result = await shell.exec("sh apply.sh");
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.operation, "template.apply");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.affected, 2);
    assert.deepEqual(envelope.errors, []);
    const output = new Uint8Array(volume.readFileSync("/work/bound deck.pptx") as Buffer);
    const sdk = await pptx.applyTemplateBindings(input, bindings, context);
    assert.deepEqual(output, sdk.bytes);
    const selected = await pptx.readPresentationText(
      output,
      { select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } } },
      context
    );
    assert.equal(
      selected.text,
      "海 🐚 {literal} $(echo untouched) / 海 🐚 {literal} $(echo untouched) / {literal}"
    );
    assert.equal(
      (
        await pptx.readPresentationText(
          output,
          { select: { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } } },
          context
        )
      ).text,
      "{{coast}}"
    );
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/海 input.pptx") as Buffer), input);
  } finally {
    await shell.dispose();
  }
});

test("binding file input supports dry-run and protects the binding source from output", async () => {
  const { shell, volume } = fixture();
  const input = await originalDeck();
  volume.writeFileSync("/work/deck.pptx", input);
  const data = JSON.stringify(bindings);
  volume.writeFileSync("/work/bindings.json", data);
  try {
    const dry = await shell.exec(
      "pptx template apply deck.pptx --data-file bindings.json --dry-run --json"
    );
    assert.equal(dry.exitCode, 0, dry.stdout + dry.stderr);
    assert.equal(JSON.parse(dry.stdout).affected, 2);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
    assert.equal(volume.readFileSync("/work/bindings.json", "utf8"), data);
    const alias = await shell.exec(
      "pptx template apply deck.pptx --data-file bindings.json --output bindings.json --force --json"
    );
    assert.equal(alias.exitCode, 2, alias.stdout + alias.stderr);
    assert.equal(JSON.parse(alias.stdout).affected, 0);
    assert.equal(volume.readFileSync("/work/bindings.json", "utf8"), data);
    const applied = await shell.exec(
      "pptx template apply deck.pptx --data-file bindings.json --in-place --json"
    );
    assert.equal(applied.exitCode, 0, applied.stdout + applied.stderr);
    assert.equal(
      (
        await pptx.readPresentationText(
          new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer),
          { select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } } },
          context
        )
      ).text,
      "海 🐚 {literal} $(echo untouched) / 海 🐚 {literal} $(echo untouched) / {literal}"
    );
  } finally {
    await shell.dispose();
  }
});

test("invalid bindings leave input and existing output unchanged", async () => {
  const { shell, fs, volume } = fixture();
  const publication = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = publication;
  const input = await originalDeck();
  volume.writeFileSync("/work/deck.pptx", input);
  const sentinel = new Uint8Array([8, 5, 3, 1]);
  volume.writeFileSync("/work/existing.pptx", sentinel);
  const cases = [
    { data: [{ ...bindings[0], name: "absent" }], exit: 1, code: "missing-binding" },
    { data: [{ ...bindings[0], cardinality: "one" }], exit: 1, code: "ambiguous-selection" },
    {
      data: [{ ...bindings[0], text: { expression: "globalThis" } }],
      exit: 2,
      code: "invalid-value"
    },
    { data: [{ ...bindings[0], expression: "1 + 1" }], exit: 2, code: "invalid-value" },
    { data: [{ ...bindings[0], scope: "masters" }], exit: 2, code: "invalid-value" },
    ...Object.keys(bindings[0]).map((missing) => ({
      data: [Object.fromEntries(Object.entries(bindings[0]).filter(([key]) => key !== missing))],
      exit: 2,
      code: "invalid-value"
    })),
    { data: [bindings[0], bindings[0]], exit: 2, code: "invalid-value" },
    {
      data: [bindings[0], { ...bindings[0], name: "missing later", slide: 2 }],
      exit: 1,
      code: "missing-binding"
    },
    ...[
      { kind: "table", table: [[{ value: "cell" }]] },
      { kind: "table", table: [["first"], ["second", "extra"]] },
      { kind: "image", image: { bytes: [256], contentType: "image/gif" } },
      { kind: "image", image: { bytes: [71], contentType: "image/gif", expression: "1 + 1" } },
      { kind: "image", image: { bytes: [71] } }
    ].map((value) => ({
      data: [bindings[0], { name: "later", scope: "slides", slide: 1, cardinality: "one", ...value }],
      exit: 2,
      code: "invalid-value"
    }))
  ];
  try {
    for (const { data, exit, code } of cases) {
      const result = await shell.exec(
        `pptx template apply deck.pptx --data-json '${JSON.stringify(data)}' --output existing.pptx --force --json`
      );
      assert.equal(result.exitCode, exit, result.stdout + result.stderr);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.ok, false);
      assert.equal(envelope.operation, "template.apply");
      assert.equal(envelope.errors[0].code, code);
      assert.equal(envelope.affected, 0);
      assert.equal(envelope.data, null);
      assert.equal(publication.mock.callCount(), 0);
      assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
      assert.deepEqual(
        new Uint8Array(volume.readFileSync("/work/existing.pptx") as Buffer),
        sentinel
      );
    }
    for (const flags of [
      "",
      "--data-json '[]' --data-file bindings.json",
      "--data-json '[{}'",
      '--data-json \'[{"name":"first","name":"second"}]\''
    ]) {
      const result = await shell.exec(
        `pptx template apply deck.pptx ${flags} --output existing.pptx --force --json`
      );
      assert.equal(result.exitCode, 2, result.stdout + result.stderr);
      assert.equal(JSON.parse(result.stdout).affected, 0);
      assert.equal(publication.mock.callCount(), 0);
      assert.deepEqual(
        new Uint8Array(volume.readFileSync("/work/existing.pptx") as Buffer),
        sentinel
      );
    }
  } finally {
    await shell.dispose();
  }
});

test("UTF-8 binding bytes exceed the XML budget before editing or publication", async () => {
  const limited = { ...context, xmlLimits: { ...context.xmlLimits, maxBytes: 8192 } };
  const { shell, fs, volume } = fixture(limited);
  const publication = mock.fn(fs.writeFileConditional!);
  fs.writeFileConditional = publication;
  const input = await originalDeck();
  const sentinel = new Uint8Array([4, 8, 15]);
  volume.writeFileSync("/work/deck.pptx", input);
  volume.writeFileSync("/work/existing.pptx", sentinel);
  const data = [{ ...bindings[0], text: "海".repeat(3000) }];
  try {
    const result = await shell.exec(
      `pptx template apply deck.pptx --data-json '${JSON.stringify(data)}' --output existing.pptx --force --json`
    );
    assert.equal(result.exitCode, 4, result.stdout + result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.affected, 0);
    assert.equal(envelope.data, null);
    assert.equal(envelope.errors[0].code, "resource-limit");
    assert.equal(envelope.errors[0].context.phase, "admit");
    assert.equal(publication.mock.callCount(), 0);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/deck.pptx") as Buffer), input);
    assert.deepEqual(new Uint8Array(volume.readFileSync("/work/existing.pptx") as Buffer), sentinel);
  } finally {
    await shell.dispose();
  }
});

test("table and image bindings publish structured values through CLI and SDK", async () => {
  const { shell, volume } = fixture();
  const image = new Uint8Array([
    71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 23, 67, 121, 44, 0, 0, 0, 0, 1, 0, 1, 0,
    0, 2, 2, 68, 1, 0, 59
  ]);
  const replacement = image.slice();
  replacement[16] = 103;
  const created = await pptx.addTable(
    await createPresentation({ slides: [{}] }, context),
    {
      slide: 1,
      update: {
        rows: 1,
        columns: 2,
        data: [["before", "before"]],
        left: { value: 0, unit: "emu" },
        top: { value: 0, unit: "emu" },
        width: { value: 100, unit: "emu" },
        height: { value: 40, unit: "emu" }
      }
    },
    context
  );
  const decorated = await pptx.addImage(
    created.bytes,
    { slide: 1, bytes: image, contentType: "image/gif", left: 150, top: 0, width: 40, height: 40 },
    context
  );
  const entries: { name: string; bytes: Uint8Array }[] = inspectZip(decorated).map((entry) => ({
    name: entry.name,
    bytes: entry.payload
  }));
  const slide = entries.find((entry) => entry.name === "ppt/slides/slide1.xml")!;
  let xml = parseXmlPart(slide.bytes, context.xmlLimits);
  for (const [element, marker] of [
    ["graphicFrame", "{{grid}}"],
    ["pic", "{{badge}}"]
  ]) {
    let property: XmlElement | undefined;
    function visit(node: XmlElement, inside = false) {
      const selected = inside || node.name.localName === element;
      if (selected && node.name.localName === "cNvPr") property = node;
      for (const child of node.children) visit(child, selected);
    }
    visit(xml.root);
    assert.ok(property);
    xml = xml.merge(property, {
      attributes: [{ namespace: "", localName: "name", value: marker! }]
    });
  }
  slide.bytes = xml.bytes();
  const input = await writePackageArchive(entries, context, { compression: "store" });
  const data = [
    {
      kind: "table",
      name: "grid",
      scope: "slides",
      slide: 1,
      cardinality: "one",
      table: [["海", "{literal}"]]
    },
    {
      kind: "image",
      name: "badge",
      scope: "slides",
      slide: 1,
      cardinality: "one",
      image: { bytes: [...replacement], contentType: "image/gif" }
    }
  ] as const;
  volume.writeFileSync("/work/deck.pptx", input);
  try {
    const result = await shell.exec(
      `pptx template apply deck.pptx --data-json '${JSON.stringify(data)}' --output result.pptx --json`
    );
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).affected, 2);
    const output = new Uint8Array(volume.readFileSync("/work/result.pptx") as Buffer);
    assert.deepEqual(output, (await pptx.applyTemplateBindings(input, data, context)).bytes);
    const members = inspectZip(output);
    const strings: string[] = [];
    const sizes: Record<string, string>[] = [];
    let inText = false;
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
      if (tag.local === "t") inText = true;
      if (tag.local === "ext")
        sizes.push(
          Object.fromEntries(
            Object.values(tag.attributes).map((attribute) => [attribute.local, attribute.value])
          )
        );
    });
    parser.on("text", (value) => {
      if (inText) strings.push(value);
    });
    parser.on("closetag", (tag) => {
      if (tag.local === "t") inText = false;
    });
    parser
      .write(new TextDecoder().decode(members.find((entry) => entry.name === slide.name)!.payload))
      .close();
    assert.deepEqual(strings, ["海", "{literal}"]);
    assert.ok(sizes.some((size) => size.cx === "100" && size.cy === "40"));
    assert.ok(sizes.some((size) => size.cx === "40" && size.cy === "40"));
    assert.equal(
      members.filter(
        (entry) =>
          entry.name.startsWith("ppt/media/") &&
          Buffer.from(entry.payload).equals(Buffer.from(replacement))
      ).length,
      1
    );
  } finally {
    await shell.dispose();
  }
});
