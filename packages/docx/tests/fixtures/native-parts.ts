import { textFixture, w } from "./text.js";

/** Original native owner fixture with independently selected package kind. */
export async function nativeStoryFixture(owner: string, strict: boolean, kind: "docx" | "dotx", body: string) {
  const role = owner.includes("Footer") ? "footer" : owner.includes("Comments") ? "comments" : "header";
  const tag = role === "footer" ? "ftr" : role === "comments" ? "comments" : "hdr";
  const main = owner.startsWith("document.") || owner.startsWith("story.");
  const input = await textFixture(body, main ? {} : { native: { kind: role, xml: `<w:${tag} xmlns:w="${w}">${role === "comments" ? '<w:comment w:id="2" w:author="Coast">' + body + '</w:comment>' : body}</w:${tag}>` } }, strict,
    { kind, ...(kind === "dotx" ? { modified: new Date("2026-01-02T03:04:06Z") } : {}) });
  return { input, main, role, partname: main ? "/word/document.xml" : "/word/native.xml", relationships: strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships" };
}
