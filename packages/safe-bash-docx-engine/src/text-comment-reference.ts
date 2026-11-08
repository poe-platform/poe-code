import { activeXmlChildren } from "./xml-active-children.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import type { TextContentAssignment } from "./text-raster-content.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

/** Retain a classic reference only after proving its native owner and target. */
export function assertTextCommentReference(node: XmlElement, xml: DocumentXmlEditor, policy: TextContentAssignment): void {
  const fail = (): never => { throw new UnsupportedEditError("Whole text assignment requires a verified classic comment reference."); };
  const id = node.attributes.find(attribute => attribute.namespace === node.namespace && attribute.localName === "id")?.value;
  if (!id || [...id].some(character => character < "0" || character > "9") || !Number.isSafeInteger(Number(id)) || node.children.length || node.content.some(item => item.kind !== "text" || item.text.trim()) ||
    !xml.compatibility.canEdit(node) || node.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !xml.compatibility.canEdit(attribute))) fail();
  const role = documentDialects[dialectForNamespace(node.namespace)!].r + "/comments";
  const edges = policy.graph().relationships(policy.owner).filter(edge => edge.reltype === role);
  if (edges.length !== 1 || edges[0]!.is_external || edges[0]!.fragment !== null) fail();
  const root = parseDocumentXml(edges[0]!.target_part.bytes, {}, policy.context.budget).root;
  if (root.namespace !== node.namespace || root.localName !== "comments" || activeXmlChildren(root, policy.context.budget)(root).filter(child => child.namespace === node.namespace && child.localName === "comment" && child.attributes.some(attribute => attribute.namespace === node.namespace && attribute.localName === "id" && attribute.value.length > 0 && [...attribute.value].every(character => character >= "0" && character <= "9") && Number.isSafeInteger(Number(attribute.value)) && Number(attribute.value) === Number(id))).length !== 1) fail();
}
