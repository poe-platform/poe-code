import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import {
  assertPartHashes,
  assertRelationships,
  assertSlideOrder,
  assertInheritedProperties,
  assertResourceOccurrences
} from "./assertions.js";
import { createDeckFixture } from "./fixtures/decks.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";

function graph() {
  return {
    root: "/deck",
    volume: Volume.fromJSON({
      "/deck/ppt/presentation.xml": `<s:presentation xmlns:s="${p}" xmlns:rel="${r}"><s:sldIdLst><s:sldId id="901" rel:id="first"/><s:sldId id="257" rel:id="second"/></s:sldIdLst></s:presentation>`,
      "/deck/ppt/_rels/presentation.xml.rels": `<Relationships xmlns="${relNs}"><Relationship Id="second" Type="${r}/slide" Target="slides/a.xml"/><Relationship Id="first" Type="${r}/slide" Target="slides/z.xml"/></Relationships>`,
      "/deck/ppt/slides/z.xml": `<s:sld xmlns:s="${p}" xmlns:d="${a}" xmlns:rel="${r}"><d:blip rel:embed="tile"/><d:blip rel:embed="tile"/></s:sld>`,
      "/deck/ppt/slides/a.xml": `<s:sld xmlns:s="${p}" xmlns:d="${a}" xmlns:rel="${r}"><d:blip rel:embed="tile"/></s:sld>`,
      "/deck/ppt/slides/_rels/z.xml.rels": `<Relationships xmlns="${relNs}"><Relationship Id="tile" Type="${r}/image" Target="../media/tile.bin"/><Relationship Id="website" Type="${r}/hyperlink" Target="https://example.invalid/" TargetMode="External"/></Relationships>`,
      "/deck/ppt/slides/_rels/a.xml.rels": `<Relationships xmlns="${relNs}"><Relationship Id="tile" Type="${r}/image" Target="../media/tile.bin"/></Relationships>`,
      "/deck/ppt/media/tile.bin": "abc",
      "/deck/ppt/theme/untouched.xml": "abc"
    })
  };
}

const slideOrder = [
  { id: "901", relationshipId: "first", part: "ppt/slides/z.xml" },
  { id: "257", relationshipId: "second", part: "ppt/slides/a.xml" }
];
const imageCounts = { "ppt/media/tile.bin": 3 };
const pictureOwners = ["ppt/slides/z.xml", "ppt/slides/a.xml"];
const hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("independent part assertions", () => {
  it("compares specified bytes against a declared SHA-256 vector", () => {
    assertPartHashes(graph(), { "ppt/theme/untouched.xml": hash });
  });

  it("detects a changed untouched part", () => {
    const deck = graph();
    deck.volume.writeFileSync("/deck/ppt/theme/untouched.xml", "abd");
    expect(() => assertPartHashes(deck, { "ppt/theme/untouched.xml": hash })).toThrow(
      "part hash: ppt/theme/untouched.xml"
    );
  });

  it("rejects missing parts and paths outside the supplied memory root", () => {
    expect(() => assertPartHashes(graph(), { "missing.xml": hash })).toThrow();
    expect(() => assertPartHashes(graph(), { "../outside": hash })).toThrow("part path");
  });
});

describe("independent relationship assertions", () => {
  const expected = [
    { id: "tile", type: `${r}/image`, target: "../media/tile.bin", external: false },
    { id: "website", type: `${r}/hyperlink`, target: "https://example.invalid/", external: true }
  ];

  it("checks owner-local IDs, exact edges and internal target existence", () => {
    assertRelationships(graph(), "ppt/slides/z.xml", expected);
    assertRelationships(graph(), "ppt/slides/a.xml", [expected[0]]);
  });

  it("detects omitted media even when the relationship XML is unchanged", () => {
    const deck = graph();
    deck.volume.unlinkSync("/deck/ppt/media/tile.bin");
    expect(() => assertRelationships(deck, "ppt/slides/z.xml", expected)).toThrow("missing target");
  });

  it("detects deliberately duplicated relationship IDs even with matching expectations", () => {
    const deck = graph();
    deck.volume.writeFileSync(
      "/deck/ppt/slides/_rels/z.xml.rels",
      `<Relationships xmlns="${relNs}"><Relationship Id="tile" Type="${r}/image" Target="../media/tile.bin"/><Relationship Id="tile" Type="${r}/image" Target="../media/tile.bin"/></Relationships>`
    );
    expect(() => assertRelationships(deck, "ppt/slides/z.xml", [expected[0], expected[0]])).toThrow(
      "duplicate relationship ID"
    );
  });

  it("detects a changed relationship identity", () => {
    expect(() =>
      assertRelationships(graph(), "ppt/slides/z.xml", [
        { ...expected[0], id: "wrong" },
        expected[1]
      ])
    ).toThrow("relationships: ppt/slides/z.xml");
  });

  it("handles package-root relationships in the original deck", () => {
    assertRelationships(createDeckFixture("seed-library"), "", [
      { id: "rId1", type: `${r}/officeDocument`, target: "ppt/presentation.xml", external: false },
      {
        id: "rId2",
        type: `${relNs}/metadata/core-properties`,
        target: "docProps/core.xml",
        external: false
      }
    ]);
  });
});

describe("independent slide order assertions", () => {
  it("uses the presentation order rather than filenames or relationship order", () => {
    assertSlideOrder(graph(), "ppt/presentation.xml", slideOrder);
  });

  it("detects reordered slides", () => {
    expect(() =>
      assertSlideOrder(graph(), "ppt/presentation.xml", [...slideOrder].reverse())
    ).toThrow("slide order");
  });

  it.each([
    ["duplicate slide ID", "901", "second"],
    ["duplicate slide relationship", "257", "first"],
    ["missing slide relationship", "257", "lost"]
  ])("detects %s", (message, id, relationshipId) => {
    const deck = graph();
    deck.volume.writeFileSync(
      "/deck/ppt/presentation.xml",
      `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="901" r:id="first"/><p:sldId id="${id}" r:id="${relationshipId}"/></p:sldIdLst></p:presentation>`
    );
    expect(() => assertSlideOrder(deck, "ppt/presentation.xml", slideOrder)).toThrow(message);
  });
});

describe("independent resource occurrence assertions", () => {
  it("counts the authored fixture image and accepts owners with no images", () => {
    const deck = createDeckFixture("seed-library");
    assertResourceOccurrences(deck, ["ppt/slides/slide1.xml"], { "ppt/media/tile.bmp": 1 });
    assertResourceOccurrences(deck, ["ppt/slideLayouts/slideLayout1.xml"], {});
  });

  it("keeps distinct resource parts separate even when their bytes match", () => {
    const deck = graph();
    deck.volume.writeFileSync("/deck/ppt/media/other.bin", "abc");
    deck.volume.writeFileSync(
      "/deck/ppt/slides/_rels/a.xml.rels",
      `<Relationships xmlns="${relNs}"><Relationship Id="tile" Type="${r}/image" Target="../media/other.bin"/></Relationships>`
    );
    assertResourceOccurrences(deck, pictureOwners, {
      "ppt/media/tile.bin": 2,
      "ppt/media/other.bin": 1
    });
    expect(() => assertResourceOccurrences(deck, pictureOwners, imageCounts)).toThrow(
      "resource occurrences"
    );
  });

  it("counts three occurrences of one shared resource across two owners", () => {
    assertResourceOccurrences(graph(), pictureOwners, imageCounts);
  });

  it("does not confuse resource count with occurrence count", () => {
    expect(() =>
      assertResourceOccurrences(graph(), pictureOwners, { "ppt/media/tile.bin": 1 })
    ).toThrow("resource occurrences");
  });

  it("detects missing bytes and dangling embed IDs", () => {
    const missing = graph();
    missing.volume.unlinkSync("/deck/ppt/media/tile.bin");
    expect(() => assertResourceOccurrences(missing, pictureOwners, imageCounts)).toThrow(
      "missing target"
    );
    const dangling = graph();
    dangling.volume.writeFileSync(
      "/deck/ppt/slides/a.xml",
      `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><a:blip r:embed="lost"/></p:sld>`
    );
    expect(() => assertResourceOccurrences(dangling, pictureOwners, imageCounts)).toThrow(
      "missing image relationship"
    );
  });

  it("rejects duplicate owners so callers cannot double-count an occurrence", () => {
    expect(() =>
      assertResourceOccurrences(graph(), [pictureOwners[0], pictureOwners[0]], {
        "ppt/media/tile.bin": 4
      })
    ).toThrow("duplicate resource owner");
  });
});

describe("independent inherited property assertions", () => {
  const sites = ["slide", "layout", "master"].map((name) => ({
    part: `${name}.xml`,
    path: [
      { namespace: p, localName: name },
      { namespace: a, localName: "defRPr" }
    ],
    attribute: { namespace: "", localName: "b" }
  }));

  it("detects flattened inheritance even if the effective value stays the same", () => {
    const deck = {
      root: "/deck",
      volume: Volume.fromJSON({
        "/deck/slide.xml": `<p:slide xmlns:p="${p}" xmlns:a="${a}"><a:defRPr/></p:slide>`,
        "/deck/layout.xml": `<p:layout xmlns:p="${p}" xmlns:a="${a}"><a:defRPr b="1"/></p:layout>`
      })
    };
    const expected = { values: [null, "1"], effective: "1", source: "layout.xml" };
    assertInheritedProperties(deck, sites.slice(0, 2), expected);
    deck.volume.writeFileSync(
      "/deck/slide.xml",
      `<p:slide xmlns:p="${p}" xmlns:a="${a}"><a:defRPr b="1"/></p:slide>`
    );
    expect(() => assertInheritedProperties(deck, sites.slice(0, 2), expected)).toThrow(
      "inherited properties"
    );
  });

  it("ignores foreign namespace lookalikes for elements and attributes", () => {
    const deck = {
      root: "/deck",
      volume: Volume.fromJSON({
        "/deck/slide.xml": `<p:slide xmlns:p="${p}" xmlns:a="${a}" xmlns:x="urn:original:decoy"><x:defRPr b="1"/><a:defRPr x:b="1"/></p:slide>`
      })
    };
    assertInheritedProperties(deck, [sites[0]], { values: [null], effective: null, source: null });
  });

  it.each([
    { local: null, expected: { values: [null, "1", "0"], effective: "1", source: "layout.xml" } },
    { local: "0", expected: { values: ["0", "1", "0"], effective: "0", source: "slide.xml" } },
    { local: "", expected: { values: ["", "1", "0"], effective: "", source: "slide.xml" } }
  ])(
    "checks each supplied inheritance site and effective provenance: $local",
    ({ local, expected }) => {
      const deck = {
        root: "/deck",
        volume: Volume.fromJSON({
          "/deck/slide.xml": `<p:slide xmlns:p="${p}" xmlns:a="${a}"><a:defRPr${local === null ? "" : ` b="${local}"`}/></p:slide>`,
          "/deck/layout.xml": `<p:layout xmlns:p="${p}" xmlns:a="${a}"><a:defRPr b="1"/></p:layout>`,
          "/deck/master.xml": `<p:master xmlns:p="${p}" xmlns:a="${a}"><a:defRPr b="0"/></p:master>`
        })
      };
      assertInheritedProperties(deck, sites, expected);
      expect(() =>
        assertInheritedProperties(deck, sites, { ...expected, source: "master.xml" })
      ).toThrow("inherited properties");
    }
  );

  it("distinguishes absent properties from explicit values and rejects ambiguous sites", () => {
    const deck = {
      root: "/deck",
      volume: Volume.fromJSON({
        "/deck/slide.xml": `<p:slide xmlns:p="${p}"/>`
      })
    };
    assertInheritedProperties(deck, [sites[0]], { values: [null], effective: null, source: null });
    deck.volume.writeFileSync(
      "/deck/slide.xml",
      `<p:slide xmlns:p="${p}" xmlns:a="${a}"><a:defRPr b="1"/><a:defRPr b="0"/></p:slide>`
    );
    expect(() =>
      assertInheritedProperties(deck, [sites[0]], {
        values: ["1"],
        effective: "1",
        source: "slide.xml"
      })
    ).toThrow("ambiguous property site");
  });
});
