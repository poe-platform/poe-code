import { Volume } from "memfs";
import { writeArchive } from "../../src/index.js";
import { readPackage } from "../assertions.js";
import { textContext, textFixture, w } from "./text.js";

/** Original native owner fixture with independently selected package kind. */
export async function nativeStoryFixture(owner: string, strict: boolean, kind: "docx" | "dotx", body: string) {
  const role = owner.includes("Footer") ? "footer" : owner.includes("Comments") ? "comments" : "header";
  const tag = role === "footer" ? "ftr" : role === "comments" ? "comments" : "hdr";
  const main = owner.startsWith("document.") || owner.startsWith("story.");
  let input = await textFixture(body, main ? {} : { native: { kind: role, xml: `<w:${tag} xmlns:w="${w}">${role === "comments" ? '<w:comment w:id="2" w:author="Coast">' + body + '</w:comment>' : body}</w:${tag}>` } }, strict);
  if (kind === "dotx") {
    const members = readPackage(input);
    const types = new TextDecoder().decode(members.get("[Content_Types].xml")!);
    members.set("[Content_Types].xml", new TextEncoder().encode(types.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
    const volume = Volume.fromJSON({ "/input": "" });
    await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  }
  return { input, main, role, partname: main ? "/word/document.xml" : "/word/native.xml", relationships: strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships" };
}
