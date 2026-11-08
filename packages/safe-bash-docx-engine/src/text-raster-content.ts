import type { DocumentBudget } from "./budget.js";
import type { ArchiveContext } from "./archive.js";
import { dialectForNamespace, documentDialects } from "./dialect.js";
import { parseMediaType } from "./media-type.js";
import type { DocumentPackage } from "./package.js";
import type { XmlElement } from "./package-xml.js";
import { characterizeRasterHeader } from "./raster-header.js";
import { UnsupportedEditError, type DocumentXmlEditor } from "./xml-write.js";

export interface TextContentAssignment {
  readonly graph: () => DocumentPackage;
  readonly owner: string;
  readonly context: ArchiveContext & { readonly budget: DocumentBudget };
}

/** Destructive text setters may remove admitted raster pictures, never opaque graphics. */
export function assertTextRasterDrawing(drawing: XmlElement, xml: DocumentXmlEditor, policy: TextContentAssignment): void {
  const ns = documentDialects[dialectForNamespace(drawing.namespace)!];
  const fail = (): never => { throw new UnsupportedEditError("Whole text assignment requires an admitted embedded raster picture."); };
  const elements: XmlElement[] = [];
  const pending = [drawing];
  while (pending.length) {
    const node = pending.pop()!;
    policy.context.budget.charge("work", 1);
    policy.context.budget.charge("retainedBytes", 32);
    if (!xml.compatibility.canEdit(node) || node.attributes.some(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/" && !xml.compatibility.canEdit(attribute)) ||
      node.content.some(content => content.kind !== "element" && (content.kind !== "text" || content.text.trim() && !(node.namespace === ns.wp && ["posOffset", "align"].includes(node.localName))))) fail();
    elements.push(node);
    for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]!);
  }
  const frames = drawing.children.filter(node => node.namespace === ns.wp && ["inline", "anchor"].includes(node.localName));
  const graphics = elements.filter(node => node.namespace === ns.a && node.localName === "graphicData");
  const pictures = elements.filter(node => node.namespace === ns.pic && node.localName === "pic");
  const blips = elements.filter(node => node.namespace === ns.a && node.localName === "blip");
  if (drawing.localName !== "drawing" || frames.length !== 1 || drawing.children.length !== 1 || graphics.length !== 1 || pictures.length !== 1 || blips.length !== 1 ||
    graphics[0]!.attributes.find(attribute => !attribute.namespace && attribute.localName === "uri")?.value !== ns.pic ||
    graphics[0]!.children.length !== 1 || graphics[0]!.children[0] !== pictures[0] ||
    elements.some(node => ![ns.w, ns.wp, ns.a, ns.pic].some(namespace => namespace === node.namespace) || node.namespace === ns.w && node !== drawing || node.namespace === ns.wp && !["inline", "anchor", "extent", "docPr", "cNvGraphicFramePr", "effectExtent", "simplePos", "positionH", "positionV", "posOffset", "align", "wrapNone", "wrapSquare", "wrapTight", "wrapThrough", "wrapTopAndBottom", "wrapPolygon", "start", "lineTo"].includes(node.localName) || ["extLst", "AlternateContent"].includes(node.localName))) fail();
  const blip = blips[0]!, embed = blip.attributes.find(attribute => attribute.namespace === ns.r && attribute.localName === "embed")?.value;
  if (!embed || blip.children.some(child => child.namespace !== ns.a || !["alphaBiLevel", "alphaCeiling", "alphaFloor", "alphaInv", "alphaMod", "alphaModFix", "alphaRepl", "biLevel", "blur", "clrChange", "clrRepl", "duotone", "fillOverlay", "grayscl", "hsl", "lum", "tint"].includes(child.localName)) || blip.attributes.some(attribute => attribute.namespace === ns.r && attribute.localName !== "embed")) fail();
  const edge = policy.graph().relationships(policy.owner).find(edge => edge.rId === embed);
  if (!edge || edge.is_external || edge.reltype !== ns.r + "/image" || edge.fragment !== null) fail();
  const header = characterizeRasterHeader(edge!.target_part.bytes, policy.context);
  if (header.mime !== parseMediaType(edge!.target_part.content_type)) fail();
}
