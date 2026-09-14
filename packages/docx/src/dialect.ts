import { InvalidPackageError, type XmlElement } from "./package-xml.js";
import { MarkupCompatibility, documentCompatibilityProfile, type CompatibilityContent, type CompatibilityProfile } from "./compatibility.js";
import type { DocumentPackage, PackageRelationship } from "./package.js";
import { parseDocumentXml } from "./package-xml.js";

export type DocumentDialect = "strict" | "transitional";

// These are expanded-name vocabularies, not a promise to edit every feature.
export const documentDialects = Object.freeze({
  strict: Object.freeze({
    w: "http://purl.oclc.org/ooxml/wordprocessingml/main",
    r: "http://purl.oclc.org/ooxml/officeDocument/relationships",
    a: "http://purl.oclc.org/ooxml/drawingml/main",
    wp: "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing",
    pic: "http://purl.oclc.org/ooxml/drawingml/picture",
    c: "http://purl.oclc.org/ooxml/drawingml/chart",
    dgm: "http://purl.oclc.org/ooxml/drawingml/diagram",
    m: "http://purl.oclc.org/ooxml/officeDocument/math",
    ep: "http://purl.oclc.org/ooxml/officeDocument/extendedProperties",
    cus: "http://purl.oclc.org/ooxml/officeDocument/customProperties",
    vt: "http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes"
  }),
  transitional: Object.freeze({
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
    c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
    dgm: "http://schemas.openxmlformats.org/drawingml/2006/diagram",
    m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
    ep: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    cus: "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties",
    vt: "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
  })
});

export function dialectForNamespace(namespace: string): DocumentDialect | undefined {
  for (const dialect of ["strict", "transitional"] as const)
    if ((Object.values(documentDialects[dialect]) as readonly string[]).includes(namespace)) return dialect;
  return undefined;
}

export function validateXmlDialect(
  root: XmlElement,
  dialect: DocumentDialect,
  profile: CompatibilityProfile = documentCompatibilityProfile
): MarkupCompatibility {
  const view = new MarkupCompatibility(root, profile);
  const stack: CompatibilityContent[] = [...view.content];
  while (stack.length) {
    const node = stack.pop()!;
    if (!("source" in node) || node.disposition === "extension") continue;
    const element = node.source;
    const elementDialect = dialectForNamespace(element.namespace);
    if (elementDialect && elementDialect !== dialect)
      throw new InvalidPackageError("Active XML uses a namespace from the opposite document dialect.");
    if (dialect === "strict" && (element.namespace === "urn:schemas-microsoft-com:vml" ||
      element.namespace === "urn:schemas-microsoft-com:office:office" ||
      element.namespace === "urn:schemas-microsoft-com:office:word" ||
      (element.namespace === documentDialects.strict.w &&
        ["pict", "hMerge", "legacy", "shapeDefaults", "hdrShapeDefaults"].includes(element.localName))))
      throw new InvalidPackageError("Active legacy markup is not valid in the Strict dialect.");
    // Unknown payloads and application extension storage have their own vocabularies.
    // Only the active document vocabulary is subject to dialect consistency.
    if (!elementDialect && node.disposition === "opaque") continue;
    for (const attribute of node.attributes) {
      const attributeDialect = dialectForNamespace(attribute.namespace);
      const valueDialect = element.namespace === documentDialects[dialect].a &&
        element.localName === "graphicData" && !attribute.namespace && attribute.localName === "uri"
        ? dialectForNamespace(attribute.value) : undefined;
      if ((attributeDialect && attributeDialect !== dialect) || (valueDialect && valueDialect !== dialect))
        throw new InvalidPackageError("Active XML uses a namespace from the opposite document dialect.");
    }
    for (const child of node.content) stack.push(child);
  }
  return view;
}

const wordRoots: Readonly<Record<string, string>> = {
  "document.main": "document", "template.main": "document",
  styles: "styles", settings: "settings", numbering: "numbering", fonttable: "fonts",
  websettings: "webSettings", header: "hdr", footer: "ftr",
  comments: "comments", footnotes: "footnotes", endnotes: "endnotes"
};

export function validatePackageDialect(graph: DocumentPackage, mainEdge: PackageRelationship, root: XmlElement): DocumentDialect {
  const main = mainEdge.target_part;
  const dialect = dialectForNamespace(root.namespace);
  if (!dialect || root.namespace !== documentDialects[dialect].w || root.localName !== "document")
    throw new InvalidPackageError("The main part must have a WordprocessingML document root.");
  if (mainEdge.reltype !== `${documentDialects[dialect].r}/officeDocument`)
    throw new InvalidPackageError("The main relationship dialect disagrees with the document namespace.");
  const opposite = documentDialects[dialect === "strict" ? "transitional" : "strict"];
  for (const owner of ["/", ...graph.parts.filter(part => part.content_type.toLowerCase() !== "application/vnd.openxmlformats-package.relationships+xml").map(part => part.partname)]) {
    for (const edge of graph.relationships(owner)) {
      if (edge.reltype.startsWith(opposite.r + "/"))
        throw new InvalidPackageError("A package relationship uses the opposite document dialect.", owner, "/", "relationship-dialect");
      const prefix = documentDialects[dialect].r + "/";
      const relationshipName = edge.reltype.startsWith(prefix) ? edge.reltype.slice(prefix.length).toLowerCase() : "";
      if (Object.hasOwn(wordRoots, relationshipName) && !relationshipName.includes(".") &&
        (edge.is_external || edge.target_part.content_type.toLowerCase() !==
          `application/vnd.openxmlformats-officedocument.wordprocessingml.${relationshipName}+xml`))
        throw new InvalidPackageError("A WordprocessingML relationship target has an incompatible content type.", owner, "/", "relationship-content-type");
    }
  }
  for (const part of graph.parts) {
    const type = part.content_type.toLowerCase();
    const prefix = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
    const word = type.startsWith(prefix) && type.endsWith("+xml");
    const officeXml = type.startsWith("application/vnd.openxmlformats-officedocument.") && type.endsWith("+xml");
    if (part !== main && !officeXml) continue;
    const partRoot = part === main ? root : parseDocumentXml(part.bytes).root;
    const partDialect = dialectForNamespace(partRoot.namespace);
    if (partDialect && partDialect !== dialect)
      throw new InvalidPackageError("A document part root uses the opposite document dialect.", part.partname, "/", "part-root");
    const name = type.slice(prefix.length, -4);
    const expected = word && Object.hasOwn(wordRoots, name) ? wordRoots[name] : undefined;
    if (word && (partRoot.namespace !== documentDialects[dialect].w || (expected && partRoot.localName !== expected)))
      throw new InvalidPackageError("A WordprocessingML part root disagrees with its content type.", part.partname, "/", "part-root");
    let view: MarkupCompatibility;
    try { view = validateXmlDialect(partRoot, dialect); }
    catch (error) {
      if (!(error instanceof InvalidPackageError)) throw error;
      throw new InvalidPackageError(error.message, error.part ?? part.partname, error.location, error.diagnosticCode);
    }
    if (part === main) {
      const document = view.content.find(node => "source" in node && node.source === root);
      const bodies = document && "source" in document ? document.content.filter(node => "source" in node &&
        node.source.namespace === documentDialects[dialect].w && node.source.localName === "body") : [];
      if (bodies.length !== 1)
        throw new InvalidPackageError("The main document must contain exactly one active body.");
    }
  }
  return dialect;
}
