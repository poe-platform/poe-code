import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { parseContentTypes } from "./content-types.js";
import { readPackage } from "./package-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const limits = { maxBytes: 16384, maxEntries: 30 };
const encode = (value: string) => new TextEncoder().encode(value);
const document = (children: string) =>
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${children}</Types>`;
const main = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const children = `<Default Extension="XML" ContentType="application/xml"/><Default Extension="PNG" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/deck/main.xml" ContentType="${main}"/><Override PartName="/props/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/deck/view.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>`;

describe("content type index", () => {
  it.each([
    ["/props/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/deck/main.xml", main],
    ["/DECK/Main.XML", main],
    [
      "/deck/view.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"
    ],
    ["/unlisted/notes.xml", "application/xml"],
    ["/UNLISTED/Links.Rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["/unlisted/photo.jpeg", "image/jpeg"],
    ["/tile.png", "image/png"]
  ])("selects an override before a default for %s", (name, expected) => {
    expect(parseContentTypes(encode(document(children)), limits).get(name)).toBe(expected);
  });
  it.each(["a:b", "a@b", "a+b", "a(b)", "a,b", "a=b", "a%3fb"])(
    "accepts schema-valid extension %s",
    (extension) => {
      const types = parseContentTypes(
        encode(document(`<Default Extension="${extension}" ContentType="application/xml"/>`)),
        limits
      );
      expect(types.get(`/deck/item.${extension}`)).toBe("application/xml");
    }
  );
  it.each(["a#b", "a^b", "a`b", "a|b", "a;b", "a%", "a%GG"])(
    "rejects schema-invalid extension %s",
    (extension) => {
      expect(() =>
        parseContentTypes(
          encode(document(`<Default Extension="${extension}" ContentType="application/xml"/>`)),
          limits
        )
      ).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
    }
  );
  it("reports missing types and rejects nonstring keys", () => {
    const types = parseContentTypes(encode(document(children)), limits);
    expect(() => types.get("/media/unknown.bin")).toThrowError(
      expect.objectContaining({ code: "missing-binding" })
    );
    expect(() => types.get(5 as never)).toThrowError(
      expect.objectContaining({ code: "invalid-type" })
    );
    expect(() => types.get("/[Content_Types].xml")).toThrow();
  });
  it("honors namespace prefixes and decoded attribute characters", () => {
    const xml = `<c:Types xmlns:c="http://schemas.openxmlformats.org/package/2006/content-types"><c:Override PartName="/deck/a&amp;b.xml" ContentType="application/xml"/></c:Types>`;
    expect(parseContentTypes(encode(xml), limits).get("/DECK/a&b.xml")).toBe("application/xml");
  });
  it.each([
    "<Types/>",
    document(""),
    document('<Default Extension="xml"/>'),
    document('<Default Extension="" ContentType="application/xml"/>'),
    document('<Default Extension="a.b" ContentType="application/xml"/>'),
    document('<Default Extension="a/b" ContentType="application/xml"/>'),
    document('<Override PartName="/a/../b" ContentType="application/xml"/>'),
    document('<Override PartName="/[Content_Types].xml" ContentType="application/xml"/>'),
    document('<Default Extension="xml" ContentType="application/xml" extra="x"/>'),
    document('<Default Extension="xml" ContentType="application/xml"><Override/></Default>'),
    document("<Other/>"),
    document("non-whitespace"),
    document("<![CDATA[payload]]>"),
    '<!DOCTYPE Types SYSTEM "file:///private/secret">' + document(children),
    document(children).replace("</Types>", ""),
    document(children).replace("<Types ", '<Types xml:lang="en" '),
    document('<Default Extension="xml" ContentType="application/xml" ContentType="text/xml"/>')
  ])("rejects invalid content type XML %#", (xml) => {
    expect(() => parseContentTypes(encode(xml), limits)).toThrowError(
      expect.objectContaining({ code: expect.stringMatching("invalid-opc|unsafe-path") })
    );
  });
  it.each([
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="XML" ContentType="application/xml"/>',
    '<Override PartName="/deck/main.xml" ContentType="application/xml"/><Override PartName="/DECK/Main.XML" ContentType="text/plain"/>',
    '<Override PartName="/a%3a.xml" ContentType="application/xml"/><Override PartName="/a%3A.xml" ContentType="application/xml"/>'
  ])("rejects duplicate declarations even when values agree %#", (xml) => {
    expect(() => parseContentTypes(encode(document(xml)), limits)).toThrowError(
      expect.objectContaining({ code: "invalid-opc" })
    );
  });
  it.each([
    "text/plain;charset=utf-8",
    'Text/Plain; Charset="UTF-8"',
    'application/x-seed;note="a;b"',
    'application/x-seed;note="a\\"b"',
    "image/jpg"
  ])("preserves legal media type spelling %s", (type) => {
    const escaped = type.split("&").join("&amp;").split('"').join("&quot;");
    expect(
      parseContentTypes(
        encode(document(`<Default Extension="dat" ContentType="${escaped}"/>`)),
        limits
      ).get("/item.dat")
    ).toBe(type);
  });
  it.each([
    "",
    "application",
    "/xml",
    "app/",
    "app /xml",
    "app/xml;bad",
    "app/xml;a=",
    "app/xml;a=x;A=y",
    'app/xml;a="unterminated',
    "app/xml(comment)",
    "app/xml;a=x y",
    "application/vnd.openxmlformats-package.relationships+xml;charset=utf-8",
    `${main};charset=utf-8`
  ])("rejects malformed or forbidden parameters %s", (type) => {
    const escaped = type.split('"').join("&quot;");
    expect(() =>
      parseContentTypes(
        encode(document(`<Default Extension="xml" ContentType="${escaped}"/>`)),
        limits
      )
    ).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
  });
  it.each(["utf-16le", "utf-16be"] as const)(
    "reads %s XML with a matching declaration",
    (encoding) => {
      const value = '<?xml version="1.0" encoding="UTF-16"?>' + document(children);
      const bytes = new Uint8Array(2 + value.length * 2);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, 0xfeff, encoding === "utf-16le");
      [...value].forEach((c, index) =>
        view.setUint16(2 + index * 2, c.charCodeAt(0), encoding === "utf-16le")
      );
      expect(parseContentTypes(bytes, limits).get("/deck/main.xml")).toBe(main);
    }
  );
  it.each(["ISO-8859-1", "UTF-16"])("rejects incompatible byte declarations %s", (encoding) => {
    expect(() =>
      parseContentTypes(
        encode(`<?xml version="1.0" encoding="${encoding}"?>` + document(children)),
        limits
      )
    ).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
  });
  it("enforces byte, declaration count and malformed encoding limits", () => {
    expect(() =>
      parseContentTypes(encode(document(children)), { ...limits, maxBytes: 4 })
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
    expect(() =>
      parseContentTypes(encode(document(children)), { ...limits, maxEntries: 1 })
    ).toThrowError(expect.objectContaining({ code: "resource-limit" }));
    expect(() => parseContentTypes(Uint8Array.of(255), limits)).toThrow();
    expect(() =>
      parseContentTypes(encode(document(children)), { ...limits, maxEntries: NaN })
    ).toThrowError(expect.objectContaining({ code: "invalid-value" }));
  });
  it.each([
    ["presentation", "pptx"],
    ["template", "potx"],
    ["slideshow", "ppsx"]
  ])("distinguishes %s main parts independently of input suffix", (subtype, kind) => {
    const type = `application/vnd.openxmlformats-officedocument.presentationml.${subtype}.main+xml`;
    const types = parseContentTypes(
      encode(document(`<Override PartName="/deck/main.xml" ContentType="${type}"/>`)),
      limits
    );
    expect(types.presentationKind("/deck/main.xml")).toBe(kind);
    expect(() =>
      types.presentationKind("/deck/main.xml", kind === "pptx" ? "potx" : "pptx")
    ).toThrowError(expect.objectContaining({ code: "invalid-opc" }));
  });
  it.each([
    "application/xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"
  ])("rejects a wrong main part kind %s", (type) => {
    const types = parseContentTypes(
      encode(document(`<Override PartName="/deck/main.xml" ContentType="${type}"/>`)),
      limits
    );
    expect(() => types.presentationKind("/deck/main.xml")).toThrowError(
      expect.objectContaining({ code: "invalid-opc" })
    );
  });
  it("indexes a package admitted through an explicit memfs capability", async () => {
    const volume = Volume.fromJSON({ "/in/deck.potx": "" });
    volume.writeFileSync(
      "/in/deck.potx",
      storedArchive([
        { name: "[Content_Types].xml", bytes: encode(document(children)) },
        { name: "deck/main.xml", bytes: encode("<presentation/>") }
      ])
    );
    const reader = await readPackage(
      {
        path: "/in/deck.potx",
        capability: {
          async openRead(path) {
            const data = volume.readFileSync(path) as Uint8Array;
            let offset = 0;
            return {
              async read(maxBytes) {
                if (offset === data.length) return null;
                const chunk = data.slice(offset, offset + maxBytes);
                offset += chunk.length;
                return chunk;
              }
            };
          }
        }
      },
      {
        limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
        archiveLimits: {
          maxArchiveBytes: 65536,
          maxEntryBytes: 16384,
          maxTotalBytes: 32768,
          maxMembers: 10,
          maxPathBytes: 256,
          maxDepth: 16,
          maxPaxBytes: 1024,
          maxTextBytes: 16384,
          chunkSize: 512
        }
      }
    );
    const types = parseContentTypes(reader.get("/[Content_Types].xml"), limits);
    expect(types.presentationKind("/deck/main.xml")).toBe("pptx");
    expect(() => types.presentationKind("/deck/main.xml", "potx")).toThrow();
    expect(reader.names).toEqual(["/[Content_Types].xml", "/deck/main.xml"]);
  });
});
