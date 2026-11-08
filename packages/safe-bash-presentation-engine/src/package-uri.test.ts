import { describe, expect, it } from "vitest";
import { packageUri, resolvePartReference, relativePartReference } from "./package-uri.js";

describe("package URI metadata", () => {
  it.each([
    ["/", "/", "", "", null, "/_rels/.rels"],
    ["/deck/main.xml", "/deck", "main.xml", "xml", null, "/deck/_rels/main.xml.rels"],
    [
      "/deck/slides/page7.xml",
      "/deck/slides",
      "page7.xml",
      "xml",
      7,
      "/deck/slides/_rels/page7.xml.rels"
    ],
    [
      "/deck/media/tile42.PnG",
      "/deck/media",
      "tile42.PnG",
      "PnG",
      42,
      "/deck/media/_rels/tile42.PnG.rels"
    ],
    [
      "/deck/,seed,plot!.xml",
      "/deck",
      ",seed,plot!.xml",
      "xml",
      null,
      "/deck/_rels/,seed,plot!.xml.rels"
    ],
    ["/deck/plain", "/deck", "plain", "", null, "/deck/_rels/plain.rels"],
    ["/deck/.hidden", "/deck", ".hidden", "hidden", null, "/deck/_rels/.hidden.rels"]
  ])("describes %s without host path rules", (uri, baseURI, filename, ext, idx, relsUri) => {
    expect(packageUri(uri as string)).toMatchObject({ baseURI, filename, ext, idx, relsUri });
  });
  it.each([
    "plain",
    "//host/a",
    "/a/../b",
    "/a/./b",
    "/a//b",
    "/a/",
    "/a\\b",
    "/a%2fb",
    "/a%5Cb",
    "/%61",
    "/%2e%2e",
    "/a%00",
    "/a%GG",
    "/a?b",
    "/a#b",
    "/a.",
    "/%C3%A9"
  ])("rejects unsafe part name %s", (name) => {
    expect(() => packageUri(name)).toThrowError(expect.objectContaining({ code: "unsafe-path" }));
  });
  it("normalizes percent hex and ASCII case without folding Unicode", () => {
    expect(packageUri("/Deck/É%3a.xml")).toMatchObject({
      name: "/Deck/É%3A.xml",
      key: "/deck/É%3a.xml"
    });
    expect(packageUri("/deck/é.xml").key).not.toBe(packageUri("/deck/É.xml").key);
  });
  it.each([
    ["/", "/deck/main.xml", "deck/main.xml"],
    ["/deck", "/deck/masters/master8.xml", "masters/master8.xml"],
    ["/deck/slides", "/deck/layouts/layout9.xml", "../layouts/layout9.xml"],
    ["/deck/slides", "/deck/slides/a:b.xml", "./a:b.xml"]
  ])("resolves and emits relative references from %s", (base, target, relative) => {
    expect(relativePartReference(target, base)).toBe(relative);
    expect(resolvePartReference(base, relative)).toBe(target);
  });
  it("resolves internal dot segments and absolute targets", () => {
    expect(resolvePartReference("/deck/slides", "./../media/tile.png")).toBe(
      "/deck/media/tile.png"
    );
    expect(resolvePartReference("/deck/slides", "/other/main.xml")).toBe("/other/main.xml");
  });
  it.each([
    "../../../escape.xml",
    "//host/x",
    "https://host/x",
    "C:/x",
    "../%2e%2e/x",
    "a//b",
    "a/..",
    "a?x",
    "a#x",
    ""
  ])("rejects unsafe reference %s", (value) => {
    expect(() => resolvePartReference("/deck/slides", value)).toThrowError(
      expect.objectContaining({ code: "unsafe-path" })
    );
  });
  it("rejects coercion and unsafe integer suffixes", () => {
    expect(() => packageUri(7 as never)).toThrow();
    expect(() => packageUri("/page9007199254740992.xml")).toThrowError(
      expect.objectContaining({ code: "invalid-value" })
    );
  });
});
