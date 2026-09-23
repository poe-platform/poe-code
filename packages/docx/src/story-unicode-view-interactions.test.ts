import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { paragraph, run, table, textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const glyphs = "עברית \u2067日本\u2069 é 🌊";
const properties = '<w:rPr><w:rtl/><w:cs/><w:vanish/><w:rFonts w:ascii="Original Latin" w:eastAsia="Original CJK" w:cs="Original RTL"/><w:lang w:val="he-IL" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr>';

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently reads ordered Unicode stories and every revision view through ${carrier}; strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:inert>${paragraph("INERT")}</f:inert>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : paragraph("INERT")}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : paragraph("INERT")}</mc:Fallback></mc:AlternateContent>`;
  const attrs = `xmlns:mc="${mc}" xmlns:f="urn:original:story-views" mc:Ignorable="f" mc:ProcessContent="f:pass"`;
  const root = (tag: string, content: string) => `<w:${tag} xmlns:w="${w}" ${attrs}>${content}</w:${tag}>`;
  const section = '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:headerReference w:type="first" r:id="first"/><w:headerReference w:type="even" r:id="even"/><w:footerReference w:type="default" r:id="footer"/></w:sectPr>';
  const unicode = `<w:p ${attrs}><w:pPr><w:bidi/></w:pPr>${wrap(`<w:r>${properties}<w:t>${glyphs}</w:t><w:tab/><w:t>東京</w:t><w:cr/><w:t>North</w:t><w:br w:type="page"/><w:br w:type="column"/><w:lastRenderedPageBreak/></w:r>`)}</w:p>`;
  const reviews = `<w:p ${attrs}>${wrap(`${run("Seen ")}<w:del w:id="1"><w:r><w:delText>OLD</w:delText></w:r></w:del><w:ins w:id="2">${run("NEW")}</w:ins><w:moveFrom w:id="3">${run("FROM")}</w:moveFrom><w:moveTo w:id="4">${run("TO")}</w:moveTo><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DO NOT EXECUTE</w:instrText></w:r>${run("INSTRUCTION")}<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("42")}<w:r><w:fldChar w:fldCharType="end"/></w:r><w:fldSimple w:instr="PRIVATE">${run("CACHE")}</w:fldSimple>`)}</w:p>`;
  const input = await textFixture(unicode + `<w:p><w:pPr>${section}</w:pPr>${run("Second")}</w:p>` + reviews + table([paragraph("Left"), paragraph("Right")]) + `<w:p><w:r><w:drawing><w:txbxContent>${paragraph("Box")}</w:txbxContent></w:drawing></w:r></w:p>` + section, {
    header: { kind: "header", xml: root("hdr", wrap(paragraph("Top"))) },
    first: { kind: "header", xml: root("hdr", wrap(paragraph("First"))) },
    even: { kind: "header", xml: root("hdr", wrap(paragraph("Even"))) },
    footer: { kind: "footer", xml: root("ftr", wrap(paragraph("Bottom"))) },
    notes: { kind: "footnotes", xml: root("footnotes", wrap(`<w:footnote w:id="9">${paragraph("Nine")}</w:footnote><w:footnote w:id="-1" w:type="separator">${paragraph("SEPARATOR")}</w:footnote><w:footnote w:id="2">${paragraph("Two")}</w:footnote>`)) },
    ends: { kind: "endnotes", xml: root("endnotes", wrap(`<w:endnote w:id="7">${paragraph("End")}</w:endnote>`)) },
    comments: { kind: "comments", xml: root("comments", wrap(`<w:comment w:id="8" w:author="Original">${paragraph("Eight")}</w:comment><w:comment w:id="3" w:author="Original">${paragraph("Three")}</w:comment>`)) }
  }, strict);
  const before = readPackage(input), volume = Volume.fromJSON({ "/source": Buffer.from(input), "/saved": "" });
  assertPackageLinks(before);
  const locations = await api.openDocumentLocations(input, textContext);
  const fs = new MemoryFileSystem(); await fs.writeFile("/source", input);
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    for (const view of ["final", "original", "all"] as const) {
      const body = `${glyphs}\t東京\nNorth\f\v\nSecond\nSeen ${{ final: "NEWTO", original: "OLDFROM", all: "OLDNEWFROMTO" }[view]}42CACHE\nLeft\tRight\n`;
      const expected = { body, headers: "Top\n\nFirst\n\nEven", footers: "Bottom", footnotes: "Two\n\nNine", endnotes: "End", comments: "Three\n\nEight", "text-boxes": "Box", "all-stories": [body, "Top", "First", "Even", "Bottom", "Two", "Nine", "End", "Three", "Eight", "Box"].join("\n\n") };
      for (const scope of Object.keys(expected) as (keyof typeof expected)[]) {
        let text: api.TextData;
        if (route === "model") text = locations.text({ scope, view });
        else if (route === "sdk") text = await api.extractDocumentText(input, textContext, { scope, view });
        else {
          const result = await shell.exec(`docx text get /source --scope ${scope} --view ${view} --json`);
          expect(result.exitCode, result.stdout + result.stderr).toBe(0);
          const envelope = JSON.parse(result.stdout); expect(envelope).toMatchObject({ ok: true, operation: "text.get", affected: 0, errors: [] }); text = envelope.data;
        }
        expect(text.text, `${scope} ${view}`).toBe(expected[scope]);
        expect(text.segments.map(segment => segment.text).join(""), `${scope} ${view}`).toBe(expected[scope]);
        for (const segment of text.segments) expect(locations.resolve(segment.location.token)).toEqual(segment.location);
        if (scope === "body") {
          expect(text.segments[0]!.formatting).toMatchObject({ rtl: true, hidden: true, fonts: { ascii: "Original Latin", eastAsia: "Original CJK", cs: "Original RTL" }, language: { val: "he-IL", eastAsia: "ja-JP", bidi: "ar-SA" }, paragraph: { bidi: true } });
          expect(text.segments.filter(s => s.revision === "delete").map(s => s.text)).toEqual(view === "final" ? [] : ["OLD", "FROM"]);
          expect(text.segments.filter(s => s.revision === "insert").map(s => s.text)).toEqual(view === "original" ? [] : ["NEW", "TO"]);
        }
      }
    }
    const doc = await api.Document(input, textContext);
    expect(doc.paragraphs[0]!.text).toBe(`${glyphs}\t東京\nNorth`);
    expect(doc.paragraphs[0]!.runs[0]!.font.rtl).toBe(true);
    await doc.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/saved") as Buffer))).toEqual(before);
    expect(new Uint8Array(volume.readFileSync("/source") as Buffer)).toEqual(input);
    expect(await fs.readFile("/source")).toEqual(input);
  } finally { await shell.dispose(); }
});
