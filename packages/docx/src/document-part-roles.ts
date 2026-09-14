import type { XmlElement } from "./package-xml.js";
import { documentDialects } from "./dialect.js";

export type DocumentPartRole = "story" | "glossary" | "settings" | "custom-xml-properties";
/** Declared OPC roles establish whether a namespace spelling is a document declaration or inert data. */
export function documentPartRole(contentType: string, root: XmlElement): DocumentPartRole | null {
  const types: Readonly<Record<string, readonly [string, DocumentPartRole]>> = {
    "document.main": ["document", "story"], "template.main": ["document", "story"], header: ["hdr", "story"], footer: ["ftr", "story"], footnotes: ["footnotes", "story"], endnotes: ["endnotes", "story"], comments: ["comments", "story"], "document.glossary": ["glossaryDocument", "glossary"], settings: ["settings", "settings"],
  };
  const type = contentType.toLowerCase();
  if (type === "application/vnd.openxmlformats-officedocument.customxmlproperties+xml") return root.namespace === "http://schemas.openxmlformats.org/officeDocument/2006/customXml" && root.localName === "datastoreItem" ? "custom-xml-properties" : null;
  for (const [suffix, [name, role]] of Object.entries(types)) if (type === `application/vnd.openxmlformats-officedocument.wordprocessingml.${suffix}+xml` && root.localName === name && Object.values(documentDialects).some(dialect => dialect.w === root.namespace)) return role;
  return null;
}

export const signatureContentTypes = Object.freeze(["application/vnd.openxmlformats-package.digital-signature-origin", "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml", "application/vnd.openxmlformats-package.digital-signature-certificate"]);
export const signatureRelationshipTypes = Object.freeze(["signature", "origin", "certificate"].map(role => `http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/${role}`));
