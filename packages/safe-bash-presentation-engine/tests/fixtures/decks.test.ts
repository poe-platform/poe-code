import { describe, expect, it } from "vitest";
import { posix } from "node:path";
import { parseXml, type XmlElement } from "../../../safe-fs/src/xml.js";
import { createDeckFixture } from "./decks.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const c = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
const contentTypes = "http://schemas.openxmlformats.org/package/2006/content-types";

const expectedRelationships: Record<string, readonly (readonly string[])[]> = {
  "_rels/.rels": [
    ["rId1", `${r}/officeDocument`, "ppt/presentation.xml"],
    ["rId2", `${packageRelationships}/metadata/core-properties`, "docProps/core.xml"]
  ],
  "ppt/_rels/presentation.xml.rels": [
    ["rId1", `${r}/slideMaster`, "slideMasters/slideMaster1.xml"],
    ["rId2", `${r}/slide`, "slides/slide1.xml"]
  ],
  "ppt/slides/_rels/slide1.xml.rels": [
    ["rId1", `${r}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
    ["rId2", `${r}/image`, "../media/tile.bmp"],
    ["rId3", `${r}/chart`, "../charts/chart1.xml"]
  ],
  "ppt/slideLayouts/_rels/slideLayout1.xml.rels": [
    ["rId1", `${r}/slideMaster`, "../slideMasters/slideMaster1.xml"]
  ],
  "ppt/slideMasters/_rels/slideMaster1.xml.rels": [
    ["rId1", `${r}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
    ["rId2", `${r}/theme`, "../theme/theme1.xml"]
  ]
};

function descendants(node: XmlElement, namespace: string, localName: string): XmlElement[] {
  return [
    node,
    ...node.children.flatMap((child) => descendants(child, namespace, localName))
  ].filter((element) => element.namespace === namespace && element.localName === localName);
}

function attribute(node: XmlElement, name: string, namespace = ""): string | undefined {
  return node.attributes.find((value) => value.localName === name && value.namespace === namespace)
    ?.value;
}

const expectedFiles = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "ppt/charts/chart1.xml",
  "ppt/media/tile.bmp",
  "ppt/presentation.xml",
  "ppt/_rels/presentation.xml.rels",
  "ppt/slideLayouts/slideLayout1.xml",
  "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
  "ppt/slideMasters/slideMaster1.xml",
  "ppt/slideMasters/_rels/slideMaster1.xml.rels",
  "ppt/slides/slide1.xml",
  "ppt/slides/_rels/slide1.xml.rels",
  "ppt/theme/theme1.xml"
].sort();

const stories = [
  {
    theme: "seed-library",
    title: "Seed library",
    body: "Borrow seeds. Grow a row. Return a handful.",
    categories: ["Beans", "Peas"],
    values: ["12", "8"],
    series: "Packets shared",
    pixels: [48, 96, 32, 80, 144, 64, 0, 0, 112, 176, 96, 160, 208, 144, 0, 0]
  },
  {
    theme: "coastal-observatory",
    title: "Coastal observatory",
    body: "Read the tide. Log the wind. Share the watch.",
    categories: ["North", "South"],
    values: ["3", "5"],
    series: "Watches logged",
    pixels: [128, 64, 16, 176, 112, 32, 0, 0, 208, 160, 64, 240, 208, 128, 0, 0]
  },
  {
    theme: "bicycle-workshop",
    title: "Bicycle repair workshop",
    body: "Patch a tube. True a wheel. Teach a neighbor.",
    categories: ["Tubes", "Wheels"],
    values: ["7", "4"],
    series: "Repairs completed",
    pixels: [32, 64, 144, 64, 112, 192, 0, 0, 96, 160, 224, 144, 208, 240, 0, 0]
  }
] as const;

function readXml(fixture: ReturnType<typeof createDeckFixture>, name: string): XmlElement {
  return parseXml(fixture.volume.readFileSync(`${fixture.root}/${name}`, "utf8") as string);
}

function files(fixture: ReturnType<typeof createDeckFixture>): string[] {
  return Object.keys(fixture.volume.toJSON())
    .map((name) => name.slice(fixture.root.length + 1))
    .sort();
}

describe.each(stories)("$title fixture", (story) => {
  it("authors a complete, bounded OPC part graph in memory", () => {
    const fixture = createDeckFixture(story.theme);
    expect(fixture.root).toBe("/deck");
    expect(files(fixture)).toEqual(expectedFiles);
    let totalBytes = 0;
    for (const name of expectedFiles) {
      totalBytes += fixture.volume.statSync(`${fixture.root}/${name}`).size;
      if (name.endsWith(".bmp")) continue;
      const xml = readXml(fixture, name);
      if (!name.endsWith(".rels")) continue;
      expect(xml.namespace).toBe(packageRelationships);
      const relationships = descendants(xml, packageRelationships, "Relationship");
      expect(
        relationships.map((node) => [
          attribute(node, "Id"),
          attribute(node, "Type"),
          attribute(node, "Target")
        ])
      ).toEqual(expectedRelationships[name]);
      expect(new Set(relationships.map((rel) => attribute(rel, "Id"))).size).toBe(
        relationships.length
      );
      const directory = name === "_rels/.rels" ? "" : posix.dirname(posix.dirname(name));
      for (const rel of relationships) {
        expect(attribute(rel, "TargetMode")).toBeUndefined();
        const target = posix.normalize(posix.join(directory, attribute(rel, "Target")!));
        expect(target.startsWith("../")).toBe(false);
        expect(expectedFiles).toContain(target);
      }
    }
    expect(totalBytes).toBeLessThan(32_768);
    const types = readXml(fixture, "[Content_Types].xml");
    expect(types.namespace).toBe(contentTypes);
    const overrides = descendants(types, contentTypes, "Override");
    expect(overrides.map((node) => attribute(node, "PartName")).sort()).toEqual([
      "/docProps/core.xml",
      "/ppt/charts/chart1.xml",
      "/ppt/presentation.xml",
      "/ppt/slideLayouts/slideLayout1.xml",
      "/ppt/slideMasters/slideMaster1.xml",
      "/ppt/slides/slide1.xml",
      "/ppt/theme/theme1.xml"
    ]);
    expect(
      descendants(types, contentTypes, "Default").map((node) => [
        attribute(node, "Extension"),
        attribute(node, "ContentType")
      ])
    ).toContainEqual(["bmp", "image/bmp"]);
  });

  it("keeps master, layout, title, groups and local shape identities explicit", () => {
    const fixture = createDeckFixture(story.theme);
    const presentation = readXml(fixture, "ppt/presentation.xml");
    expect(
      descendants(presentation, p, "sldId").map((node) => [
        attribute(node, "id"),
        attribute(node, "id", r)
      ])
    ).toEqual([["256", "rId2"]]);
    expect(
      descendants(presentation, p, "sldMasterId").map((node) => attribute(node, "id"))
    ).toEqual(["2147483648"]);
    const master = readXml(fixture, "ppt/slideMasters/slideMaster1.xml");
    expect(descendants(master, p, "sldLayoutId").map((node) => attribute(node, "id"))).toEqual([
      "2147483649"
    ]);
    expect(readXml(fixture, "ppt/slideLayouts/slideLayout1.xml").localName).toBe("sldLayout");
    const slide = readXml(fixture, "ppt/slides/slide1.xml");
    expect(descendants(slide, a, "t").map((node) => node.text)).toEqual([story.title, story.body]);
    expect(descendants(slide, p, "cNvPr").map((node) => attribute(node, "id"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7"
    ]);
    const groups = descendants(slide, p, "grpSp");
    expect(groups).toHaveLength(2);
    expect(groups[0].children).toContain(groups[1]);
    expect(
      descendants(groups[0], a, "xfrm")
        .slice(0, 2)
        .map((node) =>
          node.children.map((child) => [
            child.localName,
            ...child.attributes.map((value) => value.value)
          ])
        )
    ).toEqual([
      [
        ["off", "1000000", "1500000"],
        ["ext", "4000000", "2000000"],
        ["chOff", "0", "0"],
        ["chExt", "2000000", "1000000"]
      ],
      [
        ["off", "100000", "200000"],
        ["ext", "1000000", "500000"],
        ["chOff", "0", "0"],
        ["chExt", "1000000", "500000"]
      ]
    ]);
    expect(descendants(slide, a, "blip").map((node) => attribute(node, "embed", r))).toEqual([
      "rId2"
    ]);
    expect(descendants(slide, c, "chart").map((node) => attribute(node, "id", r))).toEqual([
      "rId3"
    ]);
  });

  it("provides authored chart data and a nonexecuting timing target", () => {
    const fixture = createDeckFixture(story.theme);
    const chart = readXml(fixture, "ppt/charts/chart1.xml");
    expect(descendants(chart, c, "barChart")).toHaveLength(1);
    expect(descendants(chart, c, "ser")).toHaveLength(1);
    expect(
      descendants(chart, c, "cat")
        .flatMap((node) => descendants(node, c, "v"))
        .map((node) => node.text)
    ).toEqual(story.categories);
    expect(
      descendants(chart, c, "val")
        .flatMap((node) => descendants(node, c, "v"))
        .map((node) => node.text)
    ).toEqual(story.values);
    expect(
      descendants(chart, c, "tx")
        .flatMap((node) => descendants(node, c, "v"))
        .map((node) => node.text)
    ).toEqual([story.series]);
    expect(descendants(chart, c, "externalData")).toEqual([]);
    expect(descendants(chart, c, "axId").map((node) => attribute(node, "val"))).toEqual([
      "10",
      "20",
      "10",
      "20"
    ]);
    expect(descendants(chart, c, "crossAx").map((node) => attribute(node, "val"))).toEqual([
      "20",
      "10"
    ]);
    expect(descendants(chart, c, "ptCount").map((node) => attribute(node, "val"))).toEqual([
      "2",
      "2"
    ]);
    expect(descendants(chart, c, "pt").map((node) => attribute(node, "idx"))).toEqual([
      "0",
      "1",
      "0",
      "1"
    ]);
    const slide = readXml(fixture, "ppt/slides/slide1.xml");
    expect(descendants(slide, p, "spTgt").map((node) => attribute(node, "spid"))).toEqual(["5"]);
    expect(descendants(slide, p, "cTn").map((node) => attribute(node, "id"))).toEqual([
      "1",
      "2",
      "3",
      "4"
    ]);
    expect(descendants(slide, p, "attrName").map((node) => node.text)).toEqual([
      "style.visibility"
    ]);
    expect(descendants(slide, p, "strVal").map((node) => attribute(node, "val"))).toEqual([
      "visible"
    ]);
  });

  it("supplies original styles and fixed explicit metadata", () => {
    const fixture = createDeckFixture(story.theme);
    const theme = readXml(fixture, "ppt/theme/theme1.xml");
    for (const list of ["fillStyleLst", "lnStyleLst", "effectStyleLst", "bgFillStyleLst"]) {
      expect(descendants(theme, a, list)[0].children).toHaveLength(3);
    }
    expect(descendants(theme, a, "clrScheme")[0].children.map((node) => node.localName)).toEqual([
      "dk1",
      "lt1",
      "dk2",
      "lt2",
      "accent1",
      "accent2",
      "accent3",
      "accent4",
      "accent5",
      "accent6",
      "hlink",
      "folHlink"
    ]);
    const core = readXml(fixture, "docProps/core.xml");
    expect(descendants(core, "http://purl.org/dc/elements/1.1/", "title")[0].text).toBe(
      story.title
    );
    expect(descendants(core, "http://purl.org/dc/elements/1.1/", "creator")[0].text).toBe(
      "Community learning circle"
    );
    for (const name of ["created", "modified"]) {
      expect(descendants(core, "http://purl.org/dc/terms/", name)[0].text).toBe(
        "2026-01-01T00:00:00Z"
      );
    }
  });

  it("includes independently specified original BMP pixels", () => {
    const fixture = createDeckFixture(story.theme);
    const bytes = fixture.volume.readFileSync("/deck/ppt/media/tile.bmp") as Buffer;
    expect(bytes.length).toBe(70);
    expect([...bytes.subarray(0, 2)]).toEqual([66, 77]);
    expect([
      bytes.readUInt32LE(2),
      bytes.readUInt32LE(10),
      bytes.readUInt32LE(14),
      bytes.readInt32LE(18),
      bytes.readInt32LE(22),
      bytes.readUInt16LE(26),
      bytes.readUInt16LE(28),
      bytes.readUInt32LE(30),
      bytes.readUInt32LE(34)
    ]).toEqual([70, 54, 40, 2, 2, 1, 24, 0, 16]);
    expect([...bytes.subarray(54)]).toEqual(story.pixels);
  });

  it("creates deterministic independent volumes and byte buffers", () => {
    const first = createDeckFixture(story.theme);
    const second = createDeckFixture(story.theme);
    for (const name of expectedFiles) {
      expect(first.volume.readFileSync(`/deck/${name}`)).toEqual(
        second.volume.readFileSync(`/deck/${name}`)
      );
    }
    first.volume.writeFileSync("/deck/ppt/media/tile.bmp", new Uint8Array([0]));
    first.volume.unlinkSync("/deck/ppt/slides/slide1.xml");
    expect(second.volume.readFileSync("/deck/ppt/media/tile.bmp").length).toBe(70);
    expect(second.volume.existsSync("/deck/ppt/slides/slide1.xml")).toBe(true);
  });
});

const malformed = [
  ["missing-layout", "ppt/slideLayouts/slideLayout1.xml"],
  ["dangling-image", "ppt/slides/_rels/slide1.xml.rels"],
  ["duplicate-shape-id", "ppt/slides/slide1.xml"],
  ["dangling-timing-target", "ppt/slides/slide1.xml"],
  ["malformed-slide-xml", "ppt/slides/slide1.xml"]
] as const;

describe.each(stories)("$title negative fixtures", (story) => {
  it.each(malformed)("isolates the %s defect", (variant, changedFile) => {
    const valid = createDeckFixture(story.theme);
    const damaged = createDeckFixture(story.theme, variant);
    const changed = expectedFiles.filter(
      (name) =>
        !damaged.volume.existsSync(`/deck/${name}`) ||
        !(valid.volume.readFileSync(`/deck/${name}`) as Buffer).equals(
          damaged.volume.readFileSync(`/deck/${name}`) as Buffer
        )
    );
    expect(changed).toEqual([changedFile]);
    expect(files(damaged)).toEqual(
      variant === "missing-layout"
        ? expectedFiles.filter((name) => name !== changedFile)
        : expectedFiles
    );
    if (variant === "missing-layout") {
      expect(damaged.volume.existsSync("/deck/ppt/slideLayouts/slideLayout1.xml")).toBe(false);
    } else if (variant === "dangling-image") {
      const rels = readXml(damaged, changedFile);
      expect(
        descendants(rels, packageRelationships, "Relationship").map((node) =>
          attribute(node, "Target")
        )
      ).toContain("../media/missing.bmp");
    } else if (variant === "duplicate-shape-id") {
      expect(
        descendants(readXml(damaged, changedFile), p, "cNvPr").map((node) => attribute(node, "id"))
      ).toEqual(["1", "2", "3", "4", "5", "5", "7"]);
    } else if (variant === "dangling-timing-target") {
      expect(
        descendants(readXml(damaged, changedFile), p, "spTgt").map((node) =>
          attribute(node, "spid")
        )
      ).toEqual(["999"]);
    } else {
      expect(() => readXml(damaged, changedFile)).toThrow(SyntaxError);
    }
  });
});
