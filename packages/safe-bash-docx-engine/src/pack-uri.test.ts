import { Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { PackURI } from "./index.js";

function stored(value: string): string {
  const fs = Volume.fromJSON({ "/uri": value });
  return fs.readFileSync("/uri", "utf8") as string;
}
const values = ["/", "/reports/summary.xml", "/reports/pages/page1.xml"];

describe("package URI values", () => {
  it("constructs an owner-relative sibling URI", () => {
    expect(String(PackURI.from_rel_ref(stored("/reports/pages"), "../layouts/layout1.xml"))).toBe("/reports/layouts/layout1.xml");
  });
  it("rejects a URI without a leading slash", () => {
    expect(() => new PackURI(stored("relative"))).toThrowError(expect.objectContaining({ code: "invalid-package" }));
  });
  it("calculates root and nested base directories", () => {
    expect(values.map(value => new PackURI(stored(value)).baseURI)).toEqual(["/", "/reports", "/reports/pages"]);
  });
  it("calculates empty and XML extensions", () => {
    expect(values.map(value => new PackURI(stored(value)).ext)).toEqual(["", "xml", "xml"]);
  });
  it("calculates root and nested filenames", () => {
    expect(values.map(value => new PackURI(stored(value)).filename)).toEqual(["", "summary.xml", "page1.xml"]);
  });
  it("distinguishes absent filename numbers from one", () => {
    expect(values.map(value => new PackURI(stored(value)).idx)).toEqual([null, null, 1]);
  });
  it("calculates ZIP member names without a leading slash", () => {
    expect(values.map(value => new PackURI(stored(value)).membername)).toEqual(["", "reports/summary.xml", "reports/pages/page1.xml"]);
  });
  it("calculates relative references from root same and sibling directories", () => {
    const cases = [["/", "/reports/summary.xml", "reports/summary.xml"], ["/reports", "/reports/masters/master1.xml", "masters/master1.xml"], ["/reports/pages", "/reports/layouts/layout1.xml", "../layouts/layout1.xml"]];
    for (const [base, value, expected] of cases) expect(new PackURI(stored(value!)).relative_ref(base!)).toBe(expected);
  });
  it("calculates package and nested relationship part URIs", () => {
    expect(values.map(value => String(new PackURI(stored(value)).rels_uri))).toEqual(["/_rels/.rels", "/reports/_rels/summary.xml.rels", "/reports/pages/_rels/page1.xml.rels"]);
  });
  it("retains an immutable explicitly converted string value", () => {
    const uri = new PackURI(stored("/reports/caf%C3%A9.xml"));
    expect(uri.toString()).toBe("/reports/café.xml");
    expect(JSON.stringify(uri)).toBe('"/reports/café.xml"');
    expect(Object.isFrozen(uri)).toBe(true);
    expect(() => Object.assign(uri, { filename: "changed.xml" })).toThrow();
    expect(uri.filename).toBe("café.xml");
  });
  it.each([["/page0.xml", 0], ["/page001.xml", 1], ["/2page.xml", null], ["/page12.tar.xml", null], ["/page42", 42], ["/page9007199254740991.xml", Number.MAX_SAFE_INTEGER]] as const)("reads the checked trailing number in %s", (value, expected) => {
    expect(new PackURI(stored(value)).idx).toBe(expected);
  });
  it("rejects an unsafe filename number when it is read", () => {
    expect(() => new PackURI(stored("/page9007199254740992.xml")).idx).toThrowError(expect.objectContaining({ code: "usage" }));
  });
  it.each([undefined, null, 0, false, {}])("rejects non-string construction %j", value => {
    expect(() => new PackURI(value as unknown as string)).toThrowError(expect.objectContaining({ code: "usage" }));
  });
  it.each(["/a//b", "/a/../b", "/a%2fb", "/a b", "/a?x", "/a#x"])("rejects unsafe part spelling %s", value => {
    expect(() => new PackURI(stored(value))).toThrowError(expect.objectContaining({ code: "invalid-package" }));
  });
  it("round trips escaped Unicode and colon-leading relative targets", () => {
    const uri = new PackURI(stored("/reports/a:café.xml"));
    expect(uri.relative_ref("/reports")).toBe("./a:caf%C3%A9.xml");
    expect(String(PackURI.from_rel_ref("/reports", uri.relative_ref("/reports")))).toBe(String(uri));
  });
  it.each([["/reports", "", "/reports"], ["/", "", "/"]] as const)("retains empty relative reference from %s", (base, reference, expected) => {
    expect(String(PackURI.from_rel_ref(stored(base), reference))).toBe(expected);
  });
  it("rejects fragments in a part-only relative constructor", () => {
    expect(() => PackURI.from_rel_ref(stored("/reports"), "page.xml#anchor")).toThrowError(expect.objectContaining({ code: "invalid-package" }));
  });
  it.each([undefined, null, false, 1])("checks relative directory argument %j", value => {
    const uri = new PackURI(stored("/reports/page.xml"));
    expect(() => uri.relative_ref(value as unknown as string)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(() => PackURI.from_rel_ref(value as unknown as string, "page.xml")).toThrowError(expect.objectContaining({ code: "usage" }));
  });
});
