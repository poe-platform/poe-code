import type { AdmittedDocumentArchive } from "./admission.js";
import type { DocumentArchive } from "./archive.js";
import type { DocumentBudget } from "./budget.js";
import { xmlValue } from "./create-content.js";
import { documentDialects } from "./dialect.js";
import { relativePartTarget } from "./part-uri.js";
import { DocumentXmlEditor } from "./xml-write.js";

/** Materialize an original styles part, allocating both graph identities locally. */
export function addDocumentStylesPart(archive: DocumentArchive, template: Pick<AdmittedDocumentArchive, "package" | "mainPart" | "dialect">, styles: string, budget: DocumentBudget): { archive: DocumentArchive; name: string } {
  const name = template.package.allocatePartName("/word/styles", ".xml");
  const { w, r } = documentDialects[template.dialect];
  const types = archive.members.find(member => member.name === "[Content_Types].xml")!;
  const typesEditor = new DocumentXmlEditor(types.bytes, {}, undefined, budget);
  typesEditor.insertChildren(typesEditor.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(name)}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`);
  const main = template.mainPart, split = main.lastIndexOf("/");
  const relationshipsName = main.slice(0, split + 1) + "_rels/" + main.slice(split + 1) + ".rels";
  const relationships = archive.members.find(member => member.name === relationshipsName);
  const namespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const relEditor = new DocumentXmlEditor(relationships?.bytes ?? new TextEncoder().encode(`<Relationships xmlns="${namespace}"/>`), {}, undefined, budget);
  const id = template.package.allocateRelationshipId("/" + main);
  relEditor.insertChildren(relEditor.root, `<Relationship xmlns="${namespace}" Id="${id}" Type="${r}/styles" Target="${xmlValue(relativePartTarget("/" + main, name))}"/>`);
  const members = archive.members.map(member => member === types ? { ...member, bytes: typesEditor.serialize() } : member === relationships ? { ...member, bytes: relEditor.serialize() } : member);
  if (!relationships) members.push({ name: relationshipsName, bytes: relEditor.serialize(), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  members.push({ name: name.slice(1), bytes: new TextEncoder().encode(`<w:styles xmlns:w="${w}">${styles}</w:styles>`), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  return { archive: { ...archive, members }, name: name.slice(1) };
}
