import {describe, it, expect} from "vitest";
import {parseConversionArgs} from "./cli.js";
const signal = new AbortController().signal;
const files = {stdin: [], readFile: async () => new Uint8Array(), writeFile: async () => {}};
describe("opt-in CLI selection", () => {
  it("infers agreeing file formats and output only with yes", () => {
    expect(parseConversionArgs(["--yes", "a.md", "b.md", "-o", "out.html"], files, signal).options).toMatchObject({from: "commonmark", to: "html5"});
  });
  it("defaults stdin and stdout only with yes", () => {
    expect(parseConversionArgs(["--yes"], files, signal).options).toMatchObject({from: "commonmark", to: "html5"});
    expect(() => parseConversionArgs([], files, signal)).toThrow("select both formats");
  });
  it("treats output dash as stdout and input dash after -- as stdin", () => {
    const result = parseConversionArgs(["-f", "commonmark", "-t", "plain", "-o", "-", "--", "-"], {stdin: []}, signal);
    expect(result.destination).toBeUndefined();
    expect(result.operands?.[0]?.source).toBe("stdin");
  });
  it("rejects unknown and conflicting hints", () => {
    for (const args of [["--yes", "a.md", "b.csv"], ["--yes", "a.unknown"], ["--yes", "-o", "out.unknown"]])
      expect(() => parseConversionArgs(args, files, signal)).toThrow();
  });
  it("maps publication options to the same typed SDK", () => {
    expect(parseConversionArgs(["-f", "commonmark", "-t", "pdf", "--pdf-page-size=letter", "--pdf-orientation=landscape", "--pdf-margin=36", "--pdf-font=mono", "--pdf-font-size=18", "--pdf-line-height=1.5"], files, signal).options).toMatchObject({pdf: {pageSize: "letter", orientation: "landscape", margin: 36, font: "mono", fontSize: 18, lineHeight: 1.5}});
    expect(parseConversionArgs(["-f", "commonmark", "-t", "epub", "--epub-title=Book", "--epub-language=fr", "--epub-identifier=id", "--epub-chapter-level=2"], files, signal).options).toMatchObject({epub: {title: "Book", language: "fr", identifier: "id", chapterLevel: 2}});
  });
});
