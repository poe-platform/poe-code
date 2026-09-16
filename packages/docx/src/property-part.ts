import type { DocumentArchive } from "./archive.js";
import type { AdmittedDocumentArchive } from "./admission.js";
import type { DocumentBudget } from "./budget.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { xmlValue } from "./create-content.js";
import { propertyGroupDefinition, type PropertyGroup } from "./property-values.js";

export function createPropertyPart(archive: DocumentArchive & Pick<AdmittedDocumentArchive, "package" | "dialect">, group: PropertyGroup, budget: DocumentBudget): { archive: DocumentArchive; name: string } {
  const definition = propertyGroupDefinition(group, archive.dialect), name = archive.package.allocatePartName(definition.base, ".xml");
  const types = archive.members.find(m => m.name === "[Content_Types].xml")!, typesEditor = new DocumentXmlEditor(types.bytes, {}, undefined, budget);
  typesEditor.insertChildren(typesEditor.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="${xmlValue(name)}" ContentType="${definition.contentType}"/>`);
  const relationships = archive.members.find(m => m.name === "_rels/.rels")!, relEditor = new DocumentXmlEditor(relationships.bytes, {}, undefined, budget), id = archive.package.allocateRelationshipId("/");
  relEditor.insertChildren(relEditor.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${id}" Type="${definition.relationship}" Target="${xmlValue(name.slice(1))}"/>`);
  const members = archive.members.map(m => m === types ? { ...m, bytes: typesEditor.serialize() } : m === relationships ? { ...m, bytes: relEditor.serialize() } : m);
  members.push({ name: name.slice(1), bytes: new TextEncoder().encode(`<p:${definition.root} xmlns:p="${definition.namespace}"/>`), directory: false, modified: new Date("1980-01-01T00:00:00Z") });
  return { archive: { ...archive, members }, name };
}
