import {describe, it, expect} from "vitest";
import {parseConversionArgs} from "./cli.js";
const signal = new AbortController().signal;
const files = {stdin: [], readFile: async () => new Uint8Array(), writeFile: async () => {}};
describe("CLI format selection", () => {
  it.each([["-r", "commonmark", "-w", "html"], ["--read=commonmark", "--write=html"], ["-fcommonmark", "-thtml"], ["-rcommonmark", "-whtml"]])("accepts format aliases and attached values: %s", (...args) => {
    expect(parseConversionArgs(args, files, signal).options).toMatchObject({from: "commonmark", to: "html"});
  });
  it("accepts bare boolean metadata while preserving empty and repeated assignments", () => {
    const result = parseConversionArgs(["-fcommonmark", "-tjson", "-M", "draft", "--metadata=review", "-Mempty=", "-Mdraft=false"], files, signal);
    expect(result.options.metadataJson).toEqual([{draft: true}, {review: true}, {empty: ""}, {draft: false}]);
  });
  it("preserves literal operands and rejects repeated aliases, missing values and unsafe metadata", () => {
    expect(parseConversionArgs(["-fcommonmark", "-thtml", "-oout", "--", "-rcommonmark"], files, signal).operands?.[0]?.source).toBe("-rcommonmark");
    for (const args of [["-fcommonmark", "-r", "commonmark", "-thtml"], ["-r"], ["-w"], ["-fcommonmark", "-thtml", "-M"], ["-fcommonmark", "-thtml", "-M__proto__"], ["-fcommonmark", "-thtml", "--metadata="]])
      expect(() => parseConversionArgs(args, files, signal)).toThrow();
  });
  it.each(["html", "docx", "pdf"])("infers agreeing inputs and %s output without yes", extension => {
    expect(parseConversionArgs(["a.md", "b.md", "-o", `out.${extension}`], files, signal).options).toMatchObject({from: "commonmark", to: extension === "html" ? "html5" : extension});
  });
  it.each([[], ["-"], ["a.md"], ["document"], ["dir.md/document", "-o", "dir.html/output"]])("defaults stdin, stdout and extensionless paths: %s", (...args) => {
    expect(parseConversionArgs(args, files, signal).options).toMatchObject({from: "commonmark", to: "html5"});
  });
  it("keeps yes compatible and respects explicit formats and default inputs", () => {
    expect(parseConversionArgs(["--yes", "a.md", "-o", "out.html"], files, signal).options).toMatchObject({from: "commonmark", to: "html5"});
    expect(parseConversionArgs(["-f", "plain", "a.md", "-o", "out.html"], files, signal).options).toMatchObject({from: "plain", to: "html5"});
    expect(parseConversionArgs(["-t", "plain", "a.md", "-o", "out.html"], files, signal).options).toMatchObject({from: "commonmark", to: "plain"});
    expect(parseConversionArgs([], files, signal, ["a.html"]).options).toMatchObject({from: "html", to: "html5"});
  });
  it("treats output dash as stdout and input dash after -- as stdin", () => {
    const result = parseConversionArgs(["-f", "commonmark", "-t", "plain", "-o", "-", "--", "-"], {stdin: []}, signal);
    expect(result.destination).toBeUndefined();
    expect(result.operands?.[0]?.source).toBe("stdin");
  });
  it("rejects unknown and conflicting hints", () => {
    for (const args of [["a.md", "b.csv"], ["a.unknown"], ["-o", "out.unknown"]])
      expect(() => parseConversionArgs(args, files, signal)).toThrow();
  });
  it("maps publication options to the same typed SDK", () => {
    expect(parseConversionArgs(["-f", "commonmark", "-t", "pdf", "--pdf-page-size=letter", "--pdf-orientation=landscape", "--pdf-margin=36", "--pdf-font=mono", "--pdf-font-size=18", "--pdf-line-height=1.5"], files, signal).options).toMatchObject({pdf: {pageSize: "letter", orientation: "landscape", margin: 36, font: "mono", fontSize: 18, lineHeight: 1.5}});
    expect(parseConversionArgs(["-f", "commonmark", "-t", "epub", "--epub-title=Book", "--epub-language=fr", "--epub-identifier=id", "--epub-chapter-level=2"], files, signal).options).toMatchObject({epub: {title: "Book", language: "fr", identifier: "id", chapterLevel: 2}});
  });
});
