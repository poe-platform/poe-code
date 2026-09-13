import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { parseXmlPart } from "./xml.js";
import { OfficeError } from "./errors.js";

const limits = { maxBytes: 8192, maxNodes: 100, maxDepth: 12 };
const encode = (text: string) => new TextEncoder().encode(text);
const name = (localName: string, namespace = "urn:deck") => ({ namespace, localName });
const attribute = (localName: string, value: string | null, namespace = "") => ({
  ...name(localName, namespace),
  value
});
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("preserving XML parts", () => {
  it("reorders owned children without rewriting markup or intervening content", () => {
    const part = parseXmlPart(
      encode("<d xmlns:q=\"urn:q\"><q:a x='1'/> <!--gap--><q:b/>\n<q:c><q:n/></q:c></d>"),
      limits
    );
    const [a, b, c] = part.root.children;
    expect(text(part.reorderChildren(part.root, [c!, a!, b!]).bytes())).toBe(
      "<d xmlns:q=\"urn:q\"><q:c><q:n/></q:c> <!--gap--><q:a x='1'/>\n<q:b/></d>"
    );
  });

  it("rejects missing, repeated, foreign and nested children in permutations", () => {
    const part = parseXmlPart(encode("<d><a><n/></a><b/></d>"), limits);
    const [a, b] = part.root.children;
    const foreign = parseXmlPart(encode("<a/>"), limits).root;
    for (const order of [[a!], [a!, a!], [foreign, b!], [a!.children[0]!, b!]])
      expect(() => part.reorderChildren(part.root, order)).toThrow();
    expect(() => part.reorderChildren(foreign, [])).toThrow();
    expect(text(part.reorderChildren(part.root, [a!, b!]).bytes())).toBe("<d><a><n/></a><b/></d>");
  });

  it.each([0, 1, 2])(
    "inserts a direct child at boundary %s without rewriting neighbors",
    (index) => {
      const source = '<deck><!--lead--><item a="1"/> \n<item a="2"/><!--tail--></deck>';
      const part = parseXmlPart(encode(source), limits);
      const positions = [
        source.indexOf("<item"),
        source.indexOf('<item a="2"'),
        source.indexOf("</deck>")
      ];
      const result = part.spliceChildren(part.root, index, 0, ['<new xmlns="urn:new"/>']);
      const position = positions[index]!;
      expect(text(result.bytes())).toBe(
        source.slice(0, position) + '<new xmlns="urn:new"/>' + source.slice(position)
      );
      expect(result.root.children[index]!.name).toEqual(name("new", "urn:new"));
      expect(text(part.bytes())).toBe(source);
    }
  );

  it("replaces repeated direct children while retaining their intervening non-element content", () => {
    const source =
      "<deck><item><nested/></item><!--between-->  <item/><?tail keep?><other/></deck>";
    const part = parseXmlPart(encode(source), limits);
    expect(text(part.spliceChildren(part.root, 0, 2, ["<replacement/>"]).bytes())).toBe(
      "<deck><replacement/><!--between-->  <?tail keep?><other/></deck>"
    );
    expect(text(part.spliceChildren(part.root, 1, 1, []).bytes())).toBe(
      "<deck><item><nested/></item><!--between-->  <?tail keep?><other/></deck>"
    );
  });

  it.each(["<deck/>", "<deck />", "<deck></deck>"])(
    "inserts into empty containers: %s",
    (source) => {
      const part = parseXmlPart(encode(source), limits);
      expect(text(part.spliceChildren(part.root, 0, 0, ["<a/>", "<b/>"]).bytes())).toBe(
        source === "<deck />" ? "<deck ><a/><b/></deck>" : "<deck><a/><b/></deck>"
      );
      expect(text(part.spliceChildren(part.root, 0, 0, []).bytes())).toBe(source);
    }
  );

  it.each([
    [-1, 0],
    [2, 0],
    [0.5, 0],
    [NaN, 0],
    [0, -1],
    [0, 2],
    [1, 1],
    [0, 0.5]
  ])("rejects invalid positional edits index=%s count=%s", (index, count) => {
    const part = parseXmlPart(encode("<deck><item/></deck>"), limits);
    expect(() => part.spliceChildren(part.root, index, count, [])).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
  });

  it.each([
    "<a/><b/>",
    "<bad:child/>",
    "<!DOCTYPE a><a/>",
    '<?xml version="1.0"?><a/>',
    "<!--outside--><a/>",
    "<a/> trailing"
  ])("rejects fragments that are not one standalone element: %s", (fragment) => {
    const part = parseXmlPart(encode("<deck/>"), limits);
    expect(() => part.spliceChildren(part.root, 0, 0, [fragment])).toThrowError(
      OfficeError
    );
  });

  it("requires self-contained default namespaces when the parent supplies one", () => {
    const part = parseXmlPart(encode('<deck xmlns="urn:deck"/>'), limits);
    expect(() => part.spliceChildren(part.root, 0, 0, ["<plain/>"])).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    const result = part.spliceChildren(part.root, 0, 0, [
      '<plain xmlns=""/>',
      '<x:box xmlns:x="urn:box" xmlns=""><nested/></x:box>'
    ]);
    expect(result.root.children[0]!.name).toEqual(name("plain", ""));
    expect(result.root.children[1]!.children[0]!.name).toEqual(name("nested", ""));
  });

  it("checks foreign nodes, authored Unicode and combined resource limits", () => {
    const part = parseXmlPart(encode("<deck/>"), { ...limits, maxNodes: 3, maxDepth: 2 });
    const foreign = parseXmlPart(encode("<deck/>"), limits);
    expect(() => part.spliceChildren(foreign.root, 0, 0, [])).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    expect(() => part.spliceChildren(part.root, 0, 0, ["<a>\ud800</a>"])).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    expect(() => part.spliceChildren(part.root, 0, 0, ["<a/>", "<b/>", "<c/>"])).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
    expect(() => part.spliceChildren(part.root, 0, 0, ["<a><b/></a>"])).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
    const small = parseXmlPart(encode("<deck/>"), { ...limits, maxBytes: 15 });
    expect(() => small.spliceChildren(small.root, 0, 0, ["<child/>"])).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
  });

  it("retains exact original bytes and exposes resolved names without mutable aliases", () => {
    const source =
      '<?xml version="1.0"?>\r\n<?view original?><p:deck xmlns:p="urn:deck" a=\'&amp;\'><!--keep--><p:item/>  <![CDATA[ spaced ]]></p:deck>';
    const volume = new Volume();
    volume.writeFileSync("/part.xml", encode(source));
    const input = new Uint8Array(volume.readFileSync("/part.xml") as Uint8Array);
    const part = parseXmlPart(input, limits);
    input.fill(0);
    expect(part.root.name).toEqual(name("deck"));
    expect(part.root.children[0]!.name).toEqual(name("item"));
    expect(text(part.bytes())).toBe(source);
    part.bytes().fill(0);
    expect(text(part.merge(part.root, {}).bytes())).toBe(source);
    expect(Object.isFrozen(part.root.children)).toBe(true);
  });

  it("reports all parsed node kinds with an exact admission boundary", () => {
    const bytes = encode("<deck>text<!--note--><![CDATA[data]]><?view x?><item/></deck>");
    const part = parseXmlPart(bytes, { ...limits, maxNodes: 6 });
    expect(part.nodeCount).toBe(6);
    expect(Object.isFrozen(part)).toBe(true);
    expect(() => parseXmlPart(bytes, { ...limits, maxNodes: 5 })).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
  });

  it("merges a qualified attribute under namespace shadowing without touching other markup", () => {
    const source =
      '<p:deck xmlns:p="urn:deck" xmlns:q="urn:outer"><s:item xmlns:s="urn:deck" xmlns:q="urn:inner" q:flag=\'old\' plain = "keep">😀<!--note--><?view x?><q:unknown a="&amp;" /></s:item></p:deck>';
    const part = parseXmlPart(encode(source), limits);
    const result = part.merge(part.root.children[0]!, {
      attributes: [attribute("flag", 'A<&"\t\n\r', "urn:inner")]
    });
    expect(text(result.bytes())).toBe(
      '<p:deck xmlns:p="urn:deck" xmlns:q="urn:outer"><s:item xmlns:s="urn:deck" xmlns:q="urn:inner" q:flag=\'A&lt;&amp;"&#9;&#10;&#13;\' plain = "keep">😀<!--note--><?view x?><q:unknown a="&amp;" /></s:item></p:deck>'
    );
    expect(
      result.root.children[0]!.attributes.find((a) => a.name.namespace === "urn:inner")?.value
    ).toBe('A<&"\t\n\r');
    expect(text(part.bytes())).toBe(source);
  });

  it("inserts schema children in declared order and deeply merges an existing singleton", () => {
    const part = parseXmlPart(
      encode(
        '<d:deck xmlns:d="urn:deck"><!--lead--><d:last old="stay"><d:inner keep="yes"/></d:last><?tail x?><u:opaque xmlns:u="urn:unknown">  keep  </u:opaque></d:deck>'
      ),
      limits
    );
    const result = part.merge(part.root, {
      children: {
        sequence: [name("first"), name("last")],
        upsert: [
          {
            name: name("last"),
            merge: {
              children: {
                sequence: [name("inner")],
                upsert: [{ name: name("inner"), merge: { attributes: [attribute("new", "ok")] } }]
              }
            }
          },
          { name: name("first"), merge: { attributes: [attribute("count", "2")] } }
        ]
      }
    });
    expect(text(result.bytes())).toBe(
      '<d:deck xmlns:d="urn:deck"><!--lead--><n:first xmlns:n="urn:deck" count="2"/><d:last old="stay"><d:inner keep="yes" new="ok"/></d:last><?tail x?><u:opaque xmlns:u="urn:unknown">  keep  </u:opaque></d:deck>'
    );
  });

  it.each(["<deck/>", "<deck />", "<deck></deck>"])(
    "expands an empty element precisely: %s",
    (source) => {
      const part = parseXmlPart(encode(source), limits);
      const result = part.merge(part.root, {
        children: { sequence: [name("item")], upsert: [{ name: name("item"), merge: {} }] }
      });
      const expected =
        source === "<deck />"
          ? '<deck ><n:item xmlns:n="urn:deck"/></deck>'
          : '<deck><n:item xmlns:n="urn:deck"/></deck>';
      expect(text(result.bytes())).toBe(expected);
    }
  );

  it("preserves a default namespace while adding unqualified children and qualified attributes", () => {
    const part = parseXmlPart(encode('<deck xmlns="urn:deck" xmlns:n="urn:other"/>'), limits);
    const result = part.merge(part.root, {
      attributes: [attribute("flag", "yes", "urn:flag")],
      children: { sequence: [name("plain", "")], upsert: [{ name: name("plain", ""), merge: {} }] }
    });
    expect(result.root.attributes.find((a) => a.name.localName === "flag")).toMatchObject({
      name: name("flag", "urn:flag"),
      value: "yes"
    });
    expect(result.root.children[0]!.name).toEqual(name("plain", ""));
    expect(text(result.bytes())).toContain('<plain xmlns=""/>');
  });

  it("removes only a requested attribute and keeps lexical no-ops exact", () => {
    const part = parseXmlPart(encode("<a first = '&#65;' second=\"B\" />"), limits);
    expect(text(part.merge(part.root, { attributes: [attribute("first", "A")] }).bytes())).toBe(
      "<a first = '&#65;' second=\"B\" />"
    );
    expect(text(part.merge(part.root, { attributes: [attribute("first", null)] }).bytes())).toBe(
      '<a  second="B" />'
    );
  });

  it("orders multiple new children by schema rank rather than request order", () => {
    const part = parseXmlPart(encode('<d:deck xmlns:d="urn:deck"><d:last/></d:deck>'), limits);
    const result = part.merge(part.root, {
      children: {
        sequence: [name("first"), name("middle"), name("last")],
        upsert: [
          { name: name("middle"), merge: {} },
          { name: name("first"), merge: {} }
        ]
      }
    });
    expect(text(result.bytes())).toBe(
      '<d:deck xmlns:d="urn:deck"><n:first xmlns:n="urn:deck"/><n:middle xmlns:n="urn:deck"/><d:last/></d:deck>'
    );
  });

  it("bounds nested authored content before recursion and rejects cyclic edit descriptions", () => {
    const part = parseXmlPart(encode("<deck/>"), { ...limits, maxDepth: 2 });
    const leaf = { attributes: [attribute("x", "yes")] };
    const nested = {
      children: { sequence: [name("item")], upsert: [{ name: name("item"), merge: leaf }] }
    };
    expect(() =>
      part.merge(part.root, {
        children: { sequence: [name("item")], upsert: [{ name: name("item"), merge: nested }] }
      })
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
    const cycle: import("./xml.js").XmlMerge = {
      children: { sequence: [name("item")], upsert: [] }
    };
    (cycle.children!.upsert as { name: ReturnType<typeof name>; merge: typeof cycle }[]).push({
      name: name("item"),
      merge: cycle
    });
    expect(() => part.merge(part.root, cycle)).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
  });

  it("rejects invalid authored Unicode without replacement and admits reusable edit values", () => {
    const part = parseXmlPart(encode("<deck/>"), limits);
    expect(() => part.merge(part.root, { attributes: [attribute("bad", "\ud800")] })).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    const patch = { attributes: [attribute("x", "same")] };
    const result = part.merge(part.root, {
      children: {
        sequence: [name("one"), name("two")],
        upsert: [
          { name: name("one"), merge: patch },
          { name: name("two"), merge: patch }
        ]
      }
    });
    expect(result.root.children.map((child) => child.attributes[0]!.value)).toEqual([
      "same",
      "same"
    ]);
  });

  it.each([true, false])(
    "removes a schema singleton without touching its tail, present=%s",
    (present) => {
      const source = `<deck><!--lead-->${present ? '<item a="keep"/>' : ""}  <?tail keep?><other/></deck>`;
      const part = parseXmlPart(encode(source), limits);
      const result = part.merge(part.root, {
        children: { sequence: [name("item", "")], upsert: [], remove: [name("item", "")] }
      });
      expect(text(result.bytes())).toBe("<deck><!--lead-->  <?tail keep?><other/></deck>");
    }
  );

  it("preserves literal integer attribute values for explicit set and removal", () => {
    const part = parseXmlPart(encode('<deck amount="42"/>'), limits);
    expect(text(part.merge(part.root, { attributes: [attribute("amount", "36")] }).bytes())).toBe(
      '<deck amount="36"/>'
    );
    expect(text(part.merge(part.root, { attributes: [attribute("amount", null)] }).bytes())).toBe(
      "<deck />"
    );
  });

  it("charges all authored attributes and nodes to one work budget", () => {
    const part = parseXmlPart(encode("<deck/>"), { ...limits, maxNodes: 8 });
    expect(() =>
      part.merge(part.root, {
        children: {
          sequence: [name("item")],
          upsert: [
            {
              name: name("item"),
              merge: {
                attributes: [
                  attribute("a", "1"),
                  attribute("b", "2"),
                  attribute("c", "3"),
                  attribute("d", "4"),
                  attribute("e", "5")
                ]
              }
            }
          ]
        }
      })
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
  });

  it.each(["", "<d:chosen/>", "<d:alternate/>"])(
    "inspects and changes an explicit selection slot: %s",
    (content) => {
      const part = parseXmlPart(encode(`<d:deck xmlns:d="urn:deck">${content}</d:deck>`), limits);
      expect(part.root.children.map((child) => child.name.localName)).toEqual(
        content === "" ? [] : content === "<d:chosen/>" ? ["chosen"] : ["alternate"]
      );
      const result = part.merge(part.root, {
        children: {
          sequence: [name("chosen"), name("alternate")],
          remove: [name("alternate")],
          upsert: [{ name: name("chosen"), merge: {} }]
        }
      });
      expect(text(result.bytes())).toBe(
        content === "<d:chosen/>"
          ? '<d:deck xmlns:d="urn:deck"><d:chosen/></d:deck>'
          : '<d:deck xmlns:d="urn:deck"><n:chosen xmlns:n="urn:deck"/></d:deck>'
      );
    }
  );

  it.each([true, false])("reads and ensures an optional singleton, present=%s", (present) => {
    const part = parseXmlPart(
      encode(`<d:deck xmlns:d="urn:deck">${present ? "<d:item/>" : ""}</d:deck>`),
      limits
    );
    expect(part.root.children[0]?.name ?? null).toEqual(present ? name("item") : null);
    const result = part.merge(part.root, {
      children: { sequence: [name("item")], upsert: [{ name: name("item"), merge: {} }] }
    });
    expect(text(result.bytes())).toBe(
      present
        ? '<d:deck xmlns:d="urn:deck"><d:item/></d:deck>'
        : '<d:deck xmlns:d="urn:deck"><n:item xmlns:n="urn:deck"/></d:deck>'
    );
  });

  it("retains repeated unknown children while editing a later declared singleton", () => {
    const part = parseXmlPart(
      encode('<d:deck xmlns:d="urn:deck"><d:repeat/><d:repeat/><d:last/></d:deck>'),
      limits
    );
    expect(part.root.children.map((child) => child.name.localName)).toEqual([
      "repeat",
      "repeat",
      "last"
    ]);
    const result = part.merge(part.root, {
      children: {
        sequence: [name("last")],
        upsert: [{ name: name("last"), merge: { attributes: [attribute("flag", "yes")] } }]
      }
    });
    expect(text(result.bytes())).toBe(
      '<d:deck xmlns:d="urn:deck"><d:repeat/><d:repeat/><d:last flag="yes"/></d:deck>'
    );
  });

  it("requires explicit byte admission and preserves declared Unicode text", () => {
    expect(() => parseXmlPart("<deck/>" as unknown as Uint8Array, limits)).toThrowError(
      expect.objectContaining({ code: "invalid-type" })
    );
    const source =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<deck>\n  <item>é海😀</item>\n</deck>\n';
    expect(text(parseXmlPart(encode(source), limits).bytes())).toBe(source);
  });

  it("reads literal attributes without schema coercion or implicit defaults", () => {
    const part = parseXmlPart(encode('<deck optional="24" required="42"/>'), limits);
    expect(part.root.attributes).toEqual([
      { name: name("optional", ""), value: "24" },
      { name: name("required", ""), value: "42" }
    ]);
    expect(text(part.merge(part.root, { attributes: [attribute("required", "24")] }).bytes())).toBe(
      '<deck optional="24" required="24"/>'
    );
    expect(part.root.attributes.find((item) => item.name.localName === "absent")).toBeUndefined();
  });

  it.each(["utf-8", "utf-16le", "utf-16be"])("retains encoding and BOM for %s", (encoding) => {
    const source = `<?xml version="1.0" encoding="${encoding === "utf-8" ? "UTF-8" : "UTF-16"}"?><a x="old">😀</a>`;
    let input: Uint8Array;
    if (encoding === "utf-8") input = Uint8Array.from([239, 187, 191, ...encode(source)]);
    else {
      input = new Uint8Array(2 + source.length * 2);
      const view = new DataView(input.buffer);
      view.setUint16(0, 0xfeff, encoding === "utf-16le");
      for (let i = 0; i < source.length; i++)
        view.setUint16(2 + i * 2, source.charCodeAt(i), encoding === "utf-16le");
    }
    const part = parseXmlPart(input, limits);
    expect(part.merge(part.root, {}).bytes()).toEqual(input);
    const output = part.merge(part.root, { attributes: [attribute("x", "new")] }).bytes();
    expect(output.slice(0, encoding === "utf-8" ? 3 : 2)).toEqual(
      input.slice(0, encoding === "utf-8" ? 3 : 2)
    );
    expect(new TextDecoder(encoding).decode(output)).toBe(source.split('x="old"').join('x="new"'));
    const inserted = part.spliceChildren(part.root, 0, 0, ["<child>海</child>"]).bytes();
    expect(inserted.slice(0, encoding === "utf-8" ? 3 : 2)).toEqual(
      input.slice(0, encoding === "utf-8" ? 3 : 2)
    );
    expect(new TextDecoder(encoding).decode(inserted)).toBe(
      source.split("</a>").join("<child>海</child></a>")
    );
  });

  it.each([
    "<!DOCTYPE a><a/>",
    '<!DOCTYPE a [<!ENTITY x "value">]><a>&x;</a>',
    '<!DOCTYPE a SYSTEM "file:///private"><a/>',
    "<a>&unknown;</a>",
    "<p:a/>",
    '<a x="1" x="2"/>',
    "<a><b></a>",
    "<a/>tail",
    '<?xml version="1.1"?><a/>',
    '<?xml version="1.0" encoding="ISO-8859-1"?><a/>'
  ])("rejects unsafe or malformed XML: %s", (source) => {
    expect(() => parseXmlPart(encode(source), limits)).toThrowError(
      expect.objectContaining({ code: "invalid-xml" })
    );
  });

  it("charges bytes, depth and non-element nodes against explicit limits", () => {
    for (const [source, lower] of [
      ["<a/>", { maxBytes: 3 }],
      ["<a><b/></a>", { maxDepth: 1 }],
      ["<a><!--x--><?pi x?>text<![CDATA[x]]></a>", { maxNodes: 4 }]
    ] as const)
      expect(() => parseXmlPart(encode(source), { ...limits, ...lower })).toThrowError(
        expect.objectContaining({ code: "resource-limit" })
      );
    expect(() => parseXmlPart(encode("<a/>"), { ...limits, maxDepth: 0 })).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    const part = parseXmlPart(encode("<a/>"), { ...limits, maxBytes: 8 });
    expect(() =>
      part.merge(part.root, { attributes: [attribute("value", "too long")] })
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
  });

  it("rejects foreign handles, namespace edits, duplicate patches and ambiguous schema children", () => {
    const part = parseXmlPart(encode("<a><x/><x/></a>"), limits);
    const other = parseXmlPart(encode("<a/>"), limits);
    expect(() => part.merge(other.root, {})).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
    for (const attributes of [
      [attribute("xmlns", "urn:no")],
      [attribute("x", "1"), attribute("x", "2")],
      [attribute("bad name", "1")]
    ])
      expect(() => part.merge(part.root, { attributes })).toThrow();
    expect(() =>
      part.merge(part.root, {
        children: { sequence: [name("x", "")], upsert: [{ name: name("x", ""), merge: {} }] }
      })
    ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
    const unordered = parseXmlPart(encode("<a><last/><first/></a>"), limits);
    expect(() =>
      unordered.merge(unordered.root, {
        children: { sequence: [name("first", ""), name("last", "")], upsert: [] }
      })
    ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
  });
});

it("sets simple element text while preserving namespace bindings and attributes", () => {
  const part = parseXmlPart(
    encode('<d xmlns:q="urn:q"><q:t xml:space="preserve"><![CDATA[old]]></q:t><q:t/></d>'),
    limits
  );
  const changed = part.setText(part.root.children[0]!, "<&🐚\r");
  expect(text(changed.bytes())).toBe(
    '<d xmlns:q="urn:q"><q:t xml:space="preserve">&lt;&amp;🐚&#13;</q:t><q:t/></d>'
  );
  expect(text(changed.setText(changed.root.children[1]!, "new").bytes())).toContain(
    "<q:t>new</q:t>"
  );
  expect(() => part.setText(part.root, "discard")).toThrow();
  expect(() => part.setText(changed.root.children[0]!, "foreign")).toThrow();
  expect(() => part.setText(part.root.children[0]!, "\ud800")).toThrow();
});

it("serializes an owned subtree with inherited namespace bindings for standalone reuse", () => {
  const part = parseXmlPart(
    encode('<d xmlns:q="urn:q" xmlns:x="urn:x"><q:r><q:p x:flag="yes"/><q:t>keep</q:t></q:r></d>'),
    limits
  );
  const markup = part.markup(part.root.children[0]!, true);
  const clone = parseXmlPart(encode(markup), limits);
  expect(clone.root.name).toEqual({ namespace: "urn:q", localName: "r" });
  expect(clone.root.children[0]!.attributes).toEqual([
    { name: { namespace: "urn:x", localName: "flag" }, value: "yes" }
  ]);
  expect(part.markup(part.root.children[0]!)).toBe('<q:r><q:p x:flag="yes"/><q:t>keep</q:t></q:r>');
});
