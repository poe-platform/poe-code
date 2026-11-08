import { describe, expect, it } from "vitest";
import { createXmlElementView } from "./xml-view.js";
import { parseXmlPart, type XmlPart } from "./xml.js";

const name = (localName: string, namespace = "") => ({ namespace, localName });
function fixture(
  source = '<r xmlns:a="urn:art"><a:x n="0">A&amp;<![CDATA[B]]></a:x><y/><z/></r>',
  maxBytes = 2000
) {
  let document = parseXmlPart(new TextEncoder().encode(source), {
    maxBytes,
    maxNodes: 100,
    maxDepth: 10
  });
  let reject = false;
  const owner = {
    read: () => document,
    commit(expected: XmlPart, next: XmlPart) {
      expect(expected).toBe(document);
      if (reject) throw new Error("Graph rejected");
      document = next;
    }
  };
  return {
    root: () => createXmlElementView(owner),
    owner,
    bytes: () => new TextDecoder().decode(document.bytes()),
    reject: () => {
      reject = true;
    }
  };
}

describe("owned XML views", () => {
  it("reads qualified names, immutable attributes, ordered children and decoded leaf text", () => {
    const root = fixture().root();
    const child = root.children[0]!;
    expect(child.tag).toEqual(name("x", "urn:art"));
    expect(child.attrib).toEqual([{ name: name("n"), value: "0" }]);
    expect(Object.isFrozen(child.attrib)).toBe(true);
    expect(Object.isFrozen(root.children)).toBe(true);
    expect(child.get(name("n"))).toBe("0");
    expect(child.get(name("missing"))).toBeNull();
    expect(child.text).toBe("A&B");
    expect(root.text).toBeNull();
    expect(root.children[1]!.text).toBeNull();
  });
  it("writes and deletes namespace attributes and leaf text through its owner", () => {
    const f = fixture();
    const child = f.root().children[0]!;
    child.set(name("state", "urn:meta"), 'yes & "ok"');
    expect(child.get(name("state", "urn:meta"))).toBe('yes & "ok"');
    child.set(name("n"), null);
    expect(child.get(name("n"))).toBeNull();
    child.text = "海 < &";
    expect(child.text).toBe("海 < &");
    child.text = null;
    expect(child.text).toBeNull();
    expect(f.bytes()).toContain("<y/><z/>");
  });
  it("moves siblings with append and insert and removes/replaces without duplication", () => {
    const f = fixture();
    const root = f.root();
    root.append(root.children[0]!);
    expect(root.children.map((c) => c.tag.localName)).toEqual(["y", "z", "x"]);
    root.insert(0, root.children[2]!);
    expect(root.children.map((c) => c.tag.localName)).toEqual(["x", "y", "z"]);
    root.replace(root.children[0]!, root.children[2]!);
    expect(root.children.map((c) => c.tag.localName)).toEqual(["z", "y"]);
    root.remove(root.children[1]!);
    expect(root.children.map((c) => c.tag.localName)).toEqual(["z"]);
  });
  it("moves between parents while retaining inherited namespace bindings", () => {
    const f = fixture('<r xmlns:a="urn:art"><one><a:x/></one><two/></r>');
    const root = f.root();
    root.children[1]!.append(root.children[0]!.children[0]!);
    expect(f.root().children[0]!.children).toHaveLength(0);
    expect(f.root().children[1]!.children[0]!.tag).toEqual(name("x", "urn:art"));
  });
  it("rejects stale, foreign, cyclic and nonchild mutations", () => {
    const f = fixture();
    const root = f.root();
    const stale = root.children[0]!;
    root.set(name("v"), "1");
    expect(() => stale.tag).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
    expect(() => root.append(fixture().root())).toThrow();
    expect(() => root.children[0]!.append(root)).toThrow();
    expect(() => root.remove(root)).toThrow();
    expect(() => root.insert(-1, root.children[0]!)).toThrow();
    expect(() => {
      root.text = "destructive";
    }).toThrow();
  });
  it("adjusts destination paths when moving an earlier ancestor sibling", () => {
    const f = fixture("<r><x/><group><inner/></group></r>");
    const root = f.root();
    root.children[1]!.children[0]!.append(root.children[0]!);
    expect(f.root().children).toHaveLength(1);
    expect(f.root().children[0]!.children[0]!.children[0]!.tag).toEqual(name("x"));
  });
  it("rejects depth growth, invalid names, annotation destruction and stale writes", () => {
    const f = fixture("<r><x/><group><inner/></group></r>");
    let document = parseXmlPart(new TextEncoder().encode(f.bytes()), {
      maxBytes: 1000,
      maxDepth: 3,
      maxNodes: 10
    });
    const owner = {
      read: () => document,
      commit: (_previous: XmlPart, next: XmlPart) => {
        document = next;
      }
    };
    const root = createXmlElementView(owner);
    expect(() => root.children[1]!.children[0]!.append(root.children[0]!)).toThrowError(
      expect.objectContaining({ code: "resource-limit" })
    );
    expect(root.children).toHaveLength(2);
    expect(() => root.set(name("bad:name"), "x")).toThrow();
    expect(() => root.set(name("xmlns"), "urn:bad")).toThrow();
    expect(() => root.set(name("ok"), 1 as unknown as string)).toThrow();
    const annotated = fixture("<r><!--keep--></r>").root();
    expect(() => {
      annotated.text = "gone";
    }).toThrow();
    const stale = root.children[0]!;
    root.set(name("v"), "2");
    expect(() => stale.set(name("v"), "3")).toThrowError(
      expect.objectContaining({ code: "invalid-handle" })
    );
  });
  it("preserves owner bytes and current handles on graph and limit failures", () => {
    const f = fixture("<r><x>old</x></r>", 80);
    const child = f.root().children[0]!;
    const before = f.bytes();
    expect(() => {
      child.text = "x".repeat(100);
    }).toThrowError(expect.objectContaining({ code: "resource-limit" }));
    expect(child.text).toBe("old");
    f.reject();
    expect(() => child.set(name("v"), "x")).toThrow("Graph rejected");
    expect(child.text).toBe("old");
    expect(f.bytes()).toBe(before);
  });
});
