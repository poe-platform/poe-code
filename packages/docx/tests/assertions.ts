import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { SaxesParser } from "saxes";

type Parts = ReadonlyMap<string, Uint8Array>;
const decoder = new TextDecoder("utf-8", { fatal: true });

// Deliberately limited to small, single-disk ZIP32 test outputs without descriptors.
// No production ZIP reader, CRC implementation or decompressor is reused.
export function readPackage(bytes: Uint8Array): Map<string, Uint8Array> {
  assert(bytes.length >= 22 && bytes.length <= 1048576, "ZIP size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
  assert(end >= 0 && u32(end) === 0x06054b50, "ZIP end");
  assert.equal(end + 22 + u16(end + 20), bytes.length, "ZIP trailing bytes");
  assert.equal(u16(end + 4), 0, "ZIP disk");
  assert.equal(u16(end + 6), 0, "ZIP directory disk");
  const count = u16(end + 10);
  assert(count > 0 && count <= 128, "ZIP member count");
  assert.equal(u16(end + 8), count);
  const directory = u32(end + 16);
  assert.equal(directory + u32(end + 12), end, "ZIP directory extent");
  const parts = new Map<string, Uint8Array>();
  const ranges: [number, number][] = [];
  let cursor = directory;
  let total = 0;
  for (let i = 0; i < count; i++) {
    assert(cursor + 46 <= end && u32(cursor) === 0x02014b50, "ZIP central header");
    const flags = u16(cursor + 8),
      method = u16(cursor + 10);
    assert.equal(flags & ~0x800, 0, "ZIP unsupported flags");
    assert(method === 0 || method === 8, "ZIP method");
    assert.equal(u16(cursor + 34), 0, "ZIP entry disk");
    const crc = u32(cursor + 16),
      compressed = u32(cursor + 20),
      size = u32(cursor + 24);
    assert(size <= 262144 && (total += size) <= 1048576, "ZIP expanded limit");
    const nameLength = u16(cursor + 28);
    const next = cursor + 46 + nameLength + u16(cursor + 30) + u16(cursor + 32);
    assert(next <= end, "ZIP central extent");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decoder.decode(rawName);
    assert(name && !name.includes("\\") && !name.includes("\0") && !name.includes(":"), "ZIP name");
    assert(
      name.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
      "ZIP path"
    );
    assert(!parts.has(name), "ZIP duplicate name");
    const local = u32(cursor + 42);
    assert(local + 30 <= directory && u32(local) === 0x04034b50, "ZIP local header");
    assert.equal(u16(local + 6), flags, "ZIP local flags");
    assert.equal(u16(local + 8), method, "ZIP local method");
    assert.equal(u32(local + 14), crc, "ZIP local CRC");
    assert.equal(u32(local + 18), compressed, "ZIP local compressed size");
    assert.equal(u32(local + 22), size, "ZIP local size");
    assert.deepEqual(
      bytes.subarray(local + 30, local + 30 + u16(local + 26)),
      rawName,
      "ZIP local name"
    );
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    assert(start + compressed <= directory, "ZIP payload extent");
    ranges.push([local, start + compressed]);
    const input = bytes.subarray(start, start + compressed);
    let payload: Uint8Array;
    if (method === 8) {
      const result = inflateRawSync(input, { maxOutputLength: 262144, info: true }) as unknown as {
        buffer: Uint8Array;
        engine: { bytesWritten: number };
      };
      assert.equal(result.engine.bytesWritten, input.length, "ZIP deflate trailing bytes");
      payload = Uint8Array.from(result.buffer);
    } else payload = input.slice();
    assert.equal(payload.length, size, "ZIP payload size");
    let checksum = 0xffffffff;
    for (const byte of payload) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++)
        checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
    assert.equal((checksum ^ 0xffffffff) >>> 0, crc, "ZIP payload CRC");
    parts.set(name, payload);
    cursor = next;
  }
  assert.equal(cursor, end, "ZIP directory count");
  ranges.sort((a, b) => a[0] - b[0]);
  let boundary = 0;
  for (const [start, finish] of ranges) {
    assert.equal(start, boundary, "ZIP gap or overlap");
    boundary = finish;
  }
  assert.equal(boundary, directory);
  return parts;
}

export function assertHashes(parts: Parts, expected: Readonly<Record<string, string>>): void {
  assert.deepEqual([...parts.keys()].sort(), Object.keys(expected).sort(), "part inventory");
  for (const [name, bytes] of parts)
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected[name], name);
}

type XmlNode = { name: string; attributes: Record<string, string>; children: (XmlNode | string)[] };
const expanded = (uri: string, local: string) => `{${uri}}${local}`;
export function xmlStructure(bytes: Uint8Array): XmlNode {
  assert(bytes.length <= 262144, "XML size");
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  const document: XmlNode = { name: "#document", attributes: {}, children: [] };
  stack.push(document);
  parser.on("doctype", () => {
    assert.fail("DTD outside assertion profile");
  });
  parser.on("opentag", (tag) => {
    const node: XmlNode = {
      name: expanded(tag.uri, tag.local),
      attributes: Object.fromEntries(
        Object.values(tag.attributes)
          .filter((a) => a.uri !== "http://www.w3.org/2000/xmlns/")
          .map((a) => [expanded(a.uri, a.local), a.value] as const)
          .sort(([a], [b]) => a.localeCompare(b))
      ),
      children: []
    };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  const text = (value: string) => {
    const children = stack.at(-1)!.children;
    if (typeof children.at(-1) === "string") children[children.length - 1] += value;
    else children.push(value);
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("comment", (value) => {
    stack.at(-1)!.children.push({ name: "#comment", attributes: {}, children: [value] });
  });
  parser.on("processinginstruction", (value) => {
    stack
      .at(-1)!
      .children.push({ name: "#pi", attributes: { target: value.target }, children: [value.body] });
  });
  parser.write(decoder.decode(bytes)).close();
  return document;
}

function nodes(root: XmlNode, name?: string): XmlNode[] {
  return [
    root,
    ...root.children.flatMap((child) => (typeof child === "string" ? [] : nodes(child)))
  ].filter((node) => name === undefined || node.name === name);
}
function partXml(parts: Parts, name: string): XmlNode {
  const bytes = parts.get(name);
  assert(bytes, `missing part ${name}`);
  return xmlStructure(bytes);
}
function unique(values: (string | undefined)[], label: string): Set<string> {
  assert(
    values.every((value) => typeof value === "string" && value.length > 0),
    `${label} missing ID`
  );
  assert.equal(new Set(values).size, values.length, `${label} duplicate ID`);
  return new Set(values as string[]);
}

export function assertPackageLinks(parts: Parts): void {
  const ct = "http://schemas.openxmlformats.org/package/2006/content-types";
  const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
  const relUris = [
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "http://purl.oclc.org/ooxml/officeDocument/relationships"
  ];
  const wordRoots: Record<string, string> = {
    styles: "styles",
    numbering: "numbering",
    comments: "comments",
    footnotes: "footnotes",
    endnotes: "endnotes",
    hdr: "header",
    ftr: "footer"
  };
  const relationshipPart = (name: string) => {
    const slash = name.lastIndexOf("/");
    return `${name.slice(0, slash + 1)}_rels/${name.slice(slash + 1)}.rels`;
  };
  const declarations = nodes(partXml(parts, "[Content_Types].xml"));
  assert.equal(declarations[1]!.name, expanded(ct, "Types"), "content types namespace");
  const overrides = declarations.filter((n) => n.name === expanded(ct, "Override"));
  const defaults = declarations.filter((n) => n.name === expanded(ct, "Default"));
  unique(
    overrides.map((n) => n.attributes["{}PartName"]),
    "content types"
  );
  unique(
    defaults.map((n) => n.attributes["{}Extension"]),
    "content defaults"
  );
  for (const n of overrides)
    assert(parts.has(n.attributes["{}PartName"]!.slice(1)), "orphan content type");
  const contentType = (name: string) => {
    const declaration =
      overrides.find((n) => n.attributes["{}PartName"] === `/${name}`) ??
      defaults.find((n) => n.attributes["{}Extension"] === name.split(".").at(-1));
    assert(declaration?.attributes["{}ContentType"], `undeclared type ${name}`);
    return declaration.attributes["{}ContentType"];
  };
  for (const [name, bytes] of parts) {
    if (name === "[Content_Types].xml") continue;
    const type = contentType(name);
    if (name.endsWith(".xml")) {
      const root = nodes(xmlStructure(bytes))[1]!;
      for (const node of nodes(xmlStructure(bytes)))
        if (
          Object.keys(node.attributes).some((key) =>
            relUris.some((uri) =>
              ["id", "embed", "link"].some((local) => key === expanded(uri, local))
            )
          )
        )
          assert(parts.has(relationshipPart(name)), `missing relationships for ${name}`);
      if (name === "word/document.xml")
        assert(
          [
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"
          ].includes(type),
          "main content type"
        );
      for (const [local, suffix] of Object.entries(wordRoots)) {
        if (
          root.name ===
            expanded("http://schemas.openxmlformats.org/wordprocessingml/2006/main", local) ||
          root.name === expanded("http://purl.oclc.org/ooxml/wordprocessingml/main", local)
        )
          assert.equal(
            type,
            `application/vnd.openxmlformats-officedocument.wordprocessingml.${suffix}+xml`,
            name
          );
      }
    }
    if (!name.endsWith(".rels")) continue;
    assert.equal(type, "application/vnd.openxmlformats-package.relationships+xml");
    const tree = nodes(xmlStructure(bytes));
    assert.equal(tree[1]!.name, expanded(pr, "Relationships"), "relationships namespace");
    const edges = tree.slice(2);
    assert(
      edges.every((n) => n.name === expanded(pr, "Relationship")),
      "relationship element"
    );
    const ids = unique(
      edges.map((n) => n.attributes["{}Id"]),
      name
    );
    const split = name.lastIndexOf("_rels/");
    const owner = name === "_rels/.rels" ? null : name.slice(0, split) + name.slice(split + 6, -5);
    if (owner) assert(parts.has(owner), "missing relationship owner");
    for (const edge of edges) {
      const attrs = edge.attributes;
      assert(attrs["{}Type"] && attrs["{}Target"], "relationship fields");
      assert(
        [undefined, "External", "Internal"].includes(attrs["{}TargetMode"]),
        "relationship mode"
      );
      if (attrs["{}TargetMode"] === "External") continue;
      const target = new URL(attrs["{}Target"], `https://assertion.invalid/${owner ?? ""}`);
      assert.equal(target.origin, "https://assertion.invalid", "internal relationship origin");
      const targetName = decodeURIComponent(target.pathname.slice(1));
      assert(parts.has(targetName), `missing target ${target.pathname}`);
      if (targetName.endsWith(".xml")) {
        const targetRoot = nodes(partXml(parts, targetName))[1]!;
        const local = targetRoot.name.slice(targetRoot.name.indexOf("}") + 1);
        const role = local === "document" ? "officeDocument" : wordRoots[local];
        if (role)
          assert(
            relUris.some((uri) => attrs["{}Type"] === `${uri}/${role}`),
            "relationship role"
          );
      }
    }
    if (owner)
      for (const node of nodes(partXml(parts, owner))) {
        for (const [attribute, value] of Object.entries(node.attributes)) {
          for (const uri of [
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "http://purl.oclc.org/ooxml/officeDocument/relationships"
          ])
            if (["id", "embed", "link"].some((local) => attribute === expanded(uri, local)))
              assert(ids.has(value), `dangling relationship ${owner}:${value}`);
        }
      }
  }
  const rootEdges = nodes(partXml(parts, "_rels/.rels"), expanded(pr, "Relationship"));
  assert.equal(
    rootEdges.filter((edge) =>
      relUris.some((uri) => edge.attributes["{}Type"] === `${uri}/officeDocument`)
    ).length,
    1,
    "main relationship"
  );
}

export function assertWordReferences(parts: Parts): void {
  const root = nodes(partXml(parts, "word/document.xml"))[1]!;
  const w =
    root.name === "{http://purl.oclc.org/ooxml/wordprocessingml/main}document"
      ? "http://purl.oclc.org/ooxml/wordprocessingml/main"
      : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  assert.equal(root.name, expanded(w, "document"), "document namespace");
  const all = [...parts]
    .filter(([name]) => name.startsWith("word/") && name.endsWith(".xml"))
    .map(([name, bytes]) => ({ name, tree: xmlStructure(bytes) }));
  const attr = (node: XmlNode, local: string) => node.attributes[expanded(w, local)];
  const definitions = (part: string, tag: string, id: string) =>
    unique(
      parts.has(part) ? nodes(partXml(parts, part), expanded(w, tag)).map((n) => attr(n, id)) : [],
      part
    );
  const styles = definitions("word/styles.xml", "style", "styleId");
  const numbers = definitions("word/numbering.xml", "num", "numId");
  const abstracts = definitions("word/numbering.xml", "abstractNum", "abstractNumId");
  const numbering = parts.has("word/numbering.xml") ? partXml(parts, "word/numbering.xml") : null;
  if (numbering)
    for (const definition of nodes(numbering, expanded(w, "abstractNum")))
      unique(
        nodes(definition, expanded(w, "lvl")).map((n) => attr(n, "ilvl")),
        "numbering levels"
      );
  for (const { name, tree } of all) {
    const refs: [string[], Set<string>][] = [
      [
        ["pStyle", "rStyle", "tblStyle", "basedOn", "next", "link", "numStyleLink", "styleLink"],
        styles
      ],
      [["numId"], new Set([...numbers, "0"])],
      [["abstractNumId"], abstracts]
    ];
    for (const [tags, ids] of refs)
      for (const tag of tags)
        for (const n of nodes(tree, expanded(w, tag)))
          assert(ids.has(attr(n, "val")!), `${name} dangling ${tag}`);
    for (const properties of nodes(tree, expanded(w, "numPr"))) {
      const id = nodes(properties, expanded(w, "numId"))[0];
      if (!id || attr(id, "val") === "0") continue;
      assert(numbering, "missing numbering");
      const num = nodes(numbering, expanded(w, "num")).find(
        (n) => attr(n, "numId") === attr(id, "val")
      )!;
      const abstractId = nodes(num, expanded(w, "abstractNumId"))[0];
      const definition = nodes(numbering, expanded(w, "abstractNum")).find(
        (n) => attr(n, "abstractNumId") === attr(abstractId!, "val")
      );
      assert(definition, "missing abstract numbering");
      const level = nodes(properties, expanded(w, "ilvl"))[0];
      assert(
        nodes(definition, expanded(w, "lvl")).some(
          (n) => attr(n, "ilvl") === (level ? attr(level, "val") : "0")
        ),
        "missing list level"
      );
    }
    const wp = w.startsWith("http://purl.")
      ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing"
      : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    unique(
      nodes(tree, expanded(wp, "docPr")).map((n) => n.attributes["{}id"]),
      `${name} drawing IDs`
    );
    for (const kind of ["comment", "footnote", "endnote"]) {
      const ids = definitions(`word/${kind}s.xml`, kind, "id");
      for (const tag of kind === "comment"
        ? ["commentReference", "commentRangeStart", "commentRangeEnd"]
        : [`${kind}Reference`])
        for (const n of nodes(tree, expanded(w, tag)))
          assert(ids.has(attr(n, "id")!), `${name} dangling ${tag}`);
    }
    for (const kind of ["bookmark", "commentRange"]) {
      const starts = unique(
        nodes(tree, expanded(w, `${kind}Start`)).map((n) => attr(n, "id")),
        `${name} ${kind} starts`
      );
      const ends = unique(
        nodes(tree, expanded(w, `${kind}End`)).map((n) => attr(n, "id")),
        `${name} ${kind} ends`
      );
      assert.deepEqual(starts, ends, `${name} unmatched ${kind}`);
      const open = new Set<string>();
      for (const node of nodes(tree)) {
        if (node.name === expanded(w, `${kind}Start`)) open.add(attr(node, "id")!);
        if (node.name === expanded(w, `${kind}End`))
          assert(open.delete(attr(node, "id")!), `${name} reversed ${kind}`);
      }
    }
  }
}

export function assertPreserved(before: Parts, after: Parts, dirty: Parts): void {
  assert.deepEqual([...before.keys()].sort(), [...after.keys()].sort(), "preserved membership");
  for (const name of dirty.keys()) assert(before.has(name), `unknown dirty part ${name}`);
  for (const [name, bytes] of before) {
    if (dirty.has(name))
      assert.deepEqual(xmlStructure(after.get(name)!), xmlStructure(dirty.get(name)!), name);
    else assert.deepEqual(after.get(name), bytes, `unedited ${name}`);
  }
}

export function assertImage(actual: Uint8Array, expected: Uint8Array): void {
  assert(expected.length > 0, "empty image expectation");
  assert.deepEqual(Uint8Array.from(actual), Uint8Array.from(expected), "image payload bytes");
}

// Physical cell values only; logical merge/grid evaluation belongs to the editor.
export function assertTable(
  bytes: Uint8Array,
  index: number,
  expected: readonly (readonly string[])[]
): void {
  const tree = xmlStructure(bytes);
  const root = nodes(tree).find((n) => n.name.endsWith("}tbl"));
  assert(root, "missing table");
  const uri = root.name.slice(1, root.name.indexOf("}"));
  assert(
    [
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "http://purl.oclc.org/ooxml/wordprocessingml/main"
    ].includes(uri),
    "table namespace"
  );
  const table = nodes(tree, expanded(uri, "tbl"))[index];
  assert(table, "table index");
  const children = (n: XmlNode, tag: string) =>
    n.children.filter((c): c is XmlNode => typeof c !== "string" && c.name === expanded(uri, tag));
  const cellText = (node: XmlNode): string =>
    node.children
      .map((child) => {
        if (typeof child === "string") return node.name === expanded(uri, "t") ? child : "";
        return child.name === expanded(uri, "tbl") ? "" : cellText(child);
      })
      .join("");
  assert.deepEqual(
    children(table, "tr").map((row) => children(row, "tc").map(cellText)),
    expected,
    "table cell values"
  );
}

export function assertJsonOutput(
  output: string,
  expected: unknown,
  absent: readonly string[] = []
): void {
  const parsed: unknown = JSON.parse(output);
  assert.deepEqual(parsed, expected, "complete JSON result");
  for (const forbidden of absent) {
    assert(!output.includes(forbidden), `forbidden raw output: ${forbidden}`);
    const pending: unknown[] = [parsed];
    while (pending.length > 0) {
      const value = pending.pop();
      if (typeof value === "string")
        assert(!value.includes(forbidden), `forbidden decoded output: ${forbidden}`);
      else if (Array.isArray(value)) pending.push(...value);
      else if (value !== null && typeof value === "object")
        for (const [key, child] of Object.entries(value)) pending.push(key, child);
    }
  }
}
