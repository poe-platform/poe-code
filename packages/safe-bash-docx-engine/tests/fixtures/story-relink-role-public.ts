import { Volume } from "memfs";
import { writeArchive } from "../../src/index.js";
import { textContext, textFixture, w, r } from "./text.js";
import { readPackage } from "../assertions.js";

export async function storyRelinkRoleFixture({ strict, kind, story, variant }: {
  strict: boolean; kind: "docx" | "dotx"; story: "header" | "footer";
  variant: "default" | "first" | "even";
}) {
  const root = story === "header" ? "hdr" : "ftr";
  const input = await textFixture(`<w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:sectPr><w:${story}Reference w:type="${variant}" r:id="${story}"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`, {
    [story]: { kind: story, xml: `<w:${root} xmlns:w="${w}"><!--retained story--><w:p><w:r><w:t>日本 עברית é 🌊</w:t></w:r></w:p></w:${root}>` }
  }, strict, { kind });
  const parts = readPackage(input), rel = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  parts.set("word/_rels/document.xml.rels", new TextEncoder().encode(new TextDecoder().decode(parts.get("word/_rels/document.xml.rels")).replace(`${rel}/${story}`, "urn:original:unrelated-role")));
  const memory = Volume.fromJSON({ "/input": "", "/out": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const bytes = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const member = variant === "default" ? story : variant === "first" ? `first_page_${story}` : `even_page_${story}`;
  return { memory, bytes, parts, member: member as "header" | "footer" | "first_page_header" | "first_page_footer" | "even_page_header" | "even_page_footer" };
}
