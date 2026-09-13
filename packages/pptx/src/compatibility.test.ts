import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { parseXmlPart } from "./xml.js";
import { interpretCompatibility } from "./compatibility.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const strict = "http://purl.oclc.org/ooxml/presentationml/main";
const transitional = "http://schemas.openxmlformats.org/presentationml/2006/main";
const limits = { maxBytes: 16384, maxNodes: 200, maxDepth: 20 };
const parse = (source: string) => parseXmlPart(new TextEncoder().encode(source), limits);
const wrap = (body: string, attributes = "", namespace = strict) =>
  `<p:sld xmlns:p="${namespace}" xmlns:mc="${mc}" xmlns:x="urn:future" ${attributes}>${body}</p:sld>`;
const alternatives =
  '<mc:AlternateContent><mc:Choice Requires="x"><x:item value="new"/></mc:Choice><mc:Fallback><p:item value="old"/></mc:Fallback></mc:AlternateContent>';

describe("namespace compatibility views", () => {
  it.each([
    [strict, "strict"],
    [transitional, "transitional"]
  ])("retains the original dialect and bytes for %s", (namespace, dialect) => {
    const volume = new Volume();
    const source = wrap(alternatives, "", namespace);
    volume.writeFileSync("/slide.xml", source);
    const part = parseXmlPart(
      new Uint8Array(volume.readFileSync("/slide.xml") as Uint8Array),
      limits
    );
    const view = interpretCompatibility(part, [namespace!]);
    expect(view.dialect).toBe(dialect);
    expect(view.children(part.root).map((child) => child.name)).toEqual([
      { namespace, localName: "item" }
    ]);
    expect(new TextDecoder().decode(view.part.bytes())).toBe(source);
    expect(part.root.children[0]!.children).toHaveLength(2);
  });

  it("selects the first fully understood choice by namespace URI and local aliases", () => {
    const part = parse(
      wrap(
        '<mc:AlternateContent><mc:Choice Requires="x p"><p:wrong/></mc:Choice><mc:Choice xmlns:e="urn:enabled" Requires="e p"><e:chosen/></mc:Choice><mc:Choice Requires="p"><p:later/></mc:Choice><mc:Fallback><p:last/></mc:Fallback></mc:AlternateContent>'
      )
    );
    const supported = [strict, "urn:enabled"];
    const view = interpretCompatibility(part, supported);
    supported.push("urn:future");
    expect(view.children(part.root).map((child) => child.name)).toEqual([
      { namespace: "urn:enabled", localName: "chosen" }
    ]);
    expect(view.alternatives[0]!.selected).toBe(part.root.children[0]!.children[1]);
  });

  it("treats unselected alternatives without fallback as absent while retaining bytes", () => {
    const source = wrap(
      '<mc:AlternateContent><mc:Choice Requires="x"><x:item/></mc:Choice></mc:AlternateContent><p:tail/>'
    );
    const part = parse(source);
    const view = interpretCompatibility(part, [strict]);
    expect(view.children(part.root).map((child) => child.name.localName)).toEqual(["tail"]);
    expect(view.alternatives[0]!.selected).toBeNull();
    expect(new TextDecoder().decode(part.bytes())).toBe(source);
  });

  it("inherits URI-resolved ignorable and process-content rules across prefix shadowing", () => {
    const part = parse(
      wrap(
        '<p:body xmlns:x="urn:other" xmlns:y="urn:future"><y:skip><p:hidden/></y:skip><y:unwrap y:opaque="yes"><p:visible y:opaque="keep"/></y:unwrap></p:body>',
        'mc:Ignorable="x" mc:ProcessContent="x:unwrap"'
      )
    );
    const view = interpretCompatibility(part, [strict]);
    const body = view.children(part.root)[0]!;
    const visible = view.children(body)[0]!;
    expect(view.children(body).map((child) => child.name.localName)).toEqual(["visible"]);
    expect(view.attributes(visible)).toEqual([]);
    expect(visible.attributes[0]!.value).toBe("keep");
  });

  it("processes understood ignorable namespaces normally", () => {
    const part = parse(wrap('<x:item x:flag="yes"/>', 'mc:Ignorable="x"'));
    const view = interpretCompatibility(part, [strict, "urn:future"]);
    const item = view.children(part.root)[0]!;
    expect(view.attributes(item)[0]!.value).toBe("yes");
  });

  it("unwraps wildcard process-content names and ignores must-understand on discarded content", () => {
    const part = parse(
      wrap(
        "<x:box><p:first/></x:box><x:other><p:second/></x:other>",
        'mc:Ignorable="x" mc:ProcessContent="x:*"'
      )
    );
    expect(
      interpretCompatibility(part, [strict])
        .children(part.root)
        .map((child) => child.name.localName)
    ).toEqual(["first", "second"]);
    const ignored = parse(wrap('<x:skip mc:MustUnderstand="x"/>', 'mc:Ignorable="x"'));
    expect(interpretCompatibility(ignored, [strict]).children(ignored.root)).toEqual([]);
  });

  it("ignores required support on an unselected branch but checks the selected branch", () => {
    const part = parse(
      wrap(
        '<mc:AlternateContent><mc:Choice Requires="x" mc:MustUnderstand="x"/><mc:Fallback><p:visible/></mc:Fallback></mc:AlternateContent>'
      )
    );
    expect(
      interpretCompatibility(part, [strict])
        .children(part.root)
        .map((child) => child.name.localName)
    ).toEqual(["visible"]);
    const selected = parse(
      wrap(
        '<mc:AlternateContent><mc:Choice Requires="p" mc:MustUnderstand="x"/></mc:AlternateContent>'
      )
    );
    expect(() => interpretCompatibility(selected, [strict])).toThrowError(
      expect.objectContaining({ code: "unsupported-profile" })
    );
  });

  it("preserves ignored extension children between alternate branches", () => {
    const part = parse(
      wrap(
        '<mc:AlternateContent><x:metadata/><mc:Choice Requires="p"><p:visible/></mc:Choice><x:tail/></mc:AlternateContent>',
        'mc:Ignorable="x"'
      )
    );
    expect(
      interpretCompatibility(part, [strict])
        .children(part.root)
        .map((child) => child.name.localName)
    ).toEqual(["visible"]);
    expect(part.root.children[0]!.children).toHaveLength(3);
  });

  it.each([
    '<mc:AlternateContent xml:lang="en"><mc:Choice Requires="p"/></mc:AlternateContent>',
    '<mc:AlternateContent p:flag="yes"><mc:Choice Requires="p"/></mc:AlternateContent>',
    '<x:box mc:Ignorable="x" mc:ProcessContent="x:*" xml:space="preserve"/>'
  ])("rejects incompatible wrapper attributes: %s", (body) => {
    expect(() => interpretCompatibility(parse(wrap(body)), [strict])).toThrowError(
      expect.objectContaining({ code: "invalid-xml" })
    );
  });

  it.each([
    wrap("", 'mc:MustUnderstand="x" mc:Ignorable="x"'),
    wrap("<x:required/>"),
    wrap('<p:item x:required="yes"/>')
  ])("rejects unsupported required content: %s", (source) => {
    expect(() => interpretCompatibility(parse(source), [strict])).toThrowError(
      expect.objectContaining({ code: "unsupported-profile" })
    );
  });

  it("does not process unknown subtrees inside skipped choices or ignored elements", () => {
    const part = parse(
      wrap(
        '<x:skip><p:item mc:MustUnderstand="x"/></x:skip><mc:AlternateContent><mc:Choice Requires="x"><x:item mc:MustUnderstand="x"/></mc:Choice><mc:Fallback><p:visible/></mc:Fallback></mc:AlternateContent>',
        'mc:Ignorable="x"'
      )
    );
    expect(
      interpretCompatibility(part, [strict])
        .children(part.root)
        .map((child) => child.name.localName)
    ).toEqual(["visible"]);
  });

  it.each([
    "<mc:AlternateContent/>",
    "<mc:AlternateContent><mc:Fallback/></mc:AlternateContent>",
    '<mc:AlternateContent><mc:Choice Requires="p"/><mc:Fallback/><mc:Fallback/></mc:AlternateContent>',
    '<mc:AlternateContent><mc:Choice Requires="p"/><mc:Fallback/><mc:Choice Requires="p"/></mc:AlternateContent>',
    '<mc:AlternateContent><mc:Choice Requires="p"/><mc:Choice Requires="unbound"/></mc:AlternateContent>',
    '<mc:AlternateContent><mc:Choice Requires=""/></mc:AlternateContent>',
    '<mc:AlternateContent><mc:Choice mc:Requires="p"/></mc:AlternateContent>',
    '<mc:Choice Requires="p"/>',
    "<mc:unexpected/>",
    '<p:item mc:Unexpected="x"/>',
    '<p:item mc:ProcessContent="x:item"/>',
    '<p:item mc:Ignorable="unbound"/>',
    '<p:item mc:Ignorable="x" mc:ProcessContent="x:a:b"/>'
  ])("rejects malformed compatibility controls: %s", (body) => {
    expect(() => interpretCompatibility(parse(wrap(body)), [strict])).toThrowError(
      expect.objectContaining({ code: "invalid-xml" })
    );
  });

  it("rejects one-sided edits and removal of alternate representations", () => {
    const part = parse(wrap(alternatives));
    const view = interpretCompatibility(part, [strict]);
    const item = view.children(part.root)[0]!;
    expect(() =>
      view.merge(item, { attributes: [{ namespace: "", localName: "value", value: "changed" }] })
    ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
    expect(() =>
      view.merge(part.root, {
        children: {
          sequence: [{ namespace: mc, localName: "AlternateContent" }],
          remove: [{ namespace: mc, localName: "AlternateContent" }],
          upsert: []
        }
      })
    ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
    expect(new TextDecoder().decode(part.bytes())).toBe(wrap(alternatives));
  });

  it("permits no-op and unrelated edits without converting dialect or changing fallbacks", () => {
    const part = parse(wrap(alternatives));
    const view = interpretCompatibility(part, [strict]);
    expect(view.merge(view.children(part.root)[0]!, {}).part.bytes()).toEqual(part.bytes());
    const edited = view.merge(part.root, {
      attributes: [{ namespace: "", localName: "show", value: "0" }]
    });
    expect(edited.dialect).toBe("strict");
    expect(new TextDecoder().decode(edited.part.bytes())).toBe(
      wrap(alternatives).replace(" >", '  show="0">')
    );
  });

  it("rejects foreign handles and freezes the inspection results", () => {
    const part = parse(wrap("<p:item/>"));
    const view = interpretCompatibility(part, [strict]);
    expect(() => view.children(parse(wrap("")).root)).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    expect(Object.isFrozen(view.children(part.root))).toBe(true);
    expect(Object.isFrozen(view.alternatives)).toBe(true);
  });

  it("selects nested alternatives with aliased control namespaces and rebound extension prefixes", () => {
    const part = parse(
      wrap(
        '<c:AlternateContent xmlns:c="http://schemas.openxmlformats.org/markup-compatibility/2006"><c:Choice xmlns:x="urn:enabled" Requires="x"><c:AlternateContent><c:Choice xmlns:x="urn:future" Requires="x"><x:skip/></c:Choice><c:Fallback><p:visible/></c:Fallback></c:AlternateContent></c:Choice><c:Fallback><p:old/></c:Fallback></c:AlternateContent>'
      )
    );
    const view = interpretCompatibility(part, [strict, "urn:enabled"]);
    expect(view.children(part.root).map((child) => child.name.localName)).toEqual(["visible"]);
    expect(view.alternatives).toHaveLength(2);
  });

  it("retains UTF-16 byte order during unrelated edits", () => {
    const source = wrap(alternatives);
    const input = new Uint8Array(2 + source.length * 2);
    input.set([254, 255]);
    const data = new DataView(input.buffer);
    for (let index = 0; index < source.length; index++)
      data.setUint16(2 + index * 2, source.charCodeAt(index));
    const part = parseXmlPart(input, limits);
    const edited = interpretCompatibility(part, [strict]).merge(part.root, {
      attributes: [{ namespace: "", localName: "show", value: "0" }]
    });
    expect([...edited.part.bytes().subarray(0, 2)]).toEqual([254, 255]);
    expect(new TextDecoder("utf-16be").decode(edited.part.bytes())).toBe(
      source.replace(" >", '  show="0">')
    );
  });

  it("rejects mutation of ignored extension elements", () => {
    const part = parse(wrap("<x:opaque/>", 'mc:Ignorable="x"'));
    const view = interpretCompatibility(part, [strict]);
    expect(() =>
      view.merge(part.root.children[0]!, {
        attributes: [{ namespace: "", localName: "value", value: "changed" }]
      })
    ).toThrowError(expect.objectContaining({ code: "unsupported-edit" }));
  });

  it("retains preservation declarations and rejects malformed declarations", () => {
    const source = wrap(
      '<x:opaque x:value="yes"/>',
      'mc:Ignorable="x" mc:PreserveElements="x:*" mc:PreserveAttributes="x:value"'
    );
    const part = parse(source);
    expect(interpretCompatibility(part, [strict]).part.bytes()).toEqual(
      new TextEncoder().encode(source)
    );
    expect(() =>
      interpretCompatibility(parse(wrap("", 'mc:PreserveElements="missing:*"')), [strict])
    ).toThrowError(expect.objectContaining({ code: "invalid-xml" }));
  });

  it("keeps arbitrary namespace parts dialect-neutral and rejects foreign inspection handles", () => {
    const part = parse('<r:root xmlns:r="urn:resource"/>');
    expect(interpretCompatibility(part, ["urn:resource"]).dialect).toBeNull();
    const foreign = parse("<other/>").root;
    expect(() => part.markup(foreign)).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    expect(() => part.resolveNamespace(foreign, "r")).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
  });
});
