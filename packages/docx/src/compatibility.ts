import { InvalidValueError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import { InvalidXmlError, UnsupportedProfileError, type XmlElement, type XmlContent, type XmlAttribute } from "./package-xml.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const xml = "http://www.w3.org/XML/1998/namespace";
const xmlns = "http://www.w3.org/2000/xmlns/";
const drawingNamespaces = ["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"];

export interface ExpandedXmlName { readonly namespace: string; readonly localName: string; }
export interface CompatibilityProfile {
  readonly understoodNamespaces: readonly string[];
  readonly extensionElements?: readonly ExpandedXmlName[];
  readonly understoodElements?: readonly (ExpandedXmlName & { readonly attributes: readonly ExpandedXmlName[] })[];
}

// Namespace understanding here declares read traversal, not feature editing or rendering.
export const documentCompatibilityProfile: CompatibilityProfile = Object.freeze({
  understoodNamespaces: Object.freeze([
    "", xml,
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
    ...drawingNamespaces,
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing",
    "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "http://purl.oclc.org/ooxml/drawingml/picture",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "http://purl.oclc.org/ooxml/officeDocument/relationships",
    "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "http://purl.oclc.org/ooxml/officeDocument/math",
    "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    "http://purl.oclc.org/ooxml/officeDocument/extendedProperties",
    "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties",
    "http://purl.oclc.org/ooxml/officeDocument/customProperties",
    "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
    "http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes",
    "http://schemas.openxmlformats.org/package/2006/content-types",
    "http://schemas.openxmlformats.org/package/2006/relationships",
    "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "http://purl.org/dc/elements/1.1/",
    "http://purl.org/dc/terms/"
  ]),
  extensionElements: Object.freeze(drawingNamespaces.map(namespace => Object.freeze({ namespace, localName: "ext" }))),
  understoodElements: Object.freeze([... ["checkbox", "checked", "checkedState", "uncheckedState"].map(localName => Object.freeze({
    namespace: "http://schemas.microsoft.com/office/word/2010/wordml", localName,
    attributes: Object.freeze((localName === "checkbox" ? [] : localName === "checked" ? ["val"] : ["val", "font"]).map(name => Object.freeze({ namespace: "http://schemas.microsoft.com/office/word/2010/wordml", localName: name })))
  })), ...["repeatingSection", "repeatingSectionItem", "sectionTitle", "doNotAllowInsertDeleteSection"].map(localName => Object.freeze({
    namespace: "http://schemas.microsoft.com/office/word/2012/wordml", localName,
    attributes: Object.freeze((localName === "sectionTitle" || localName === "doNotAllowInsertDeleteSection" ? ["val"] : []).map(name => Object.freeze({ namespace: "http://schemas.microsoft.com/office/word/2012/wordml", localName: name })))
  }))])
});

export function compatibilitySettings(profile: CompatibilityProfile): CompatibilityProfile {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) ||
    Object.keys(profile).some(key => !["understoodNamespaces", "extensionElements", "understoodElements"].includes(key)) ||
    !Array.isArray(profile.understoodNamespaces) ||
    profile.understoodNamespaces.some(uri => typeof uri !== "string" || uri === mc) ||
    (profile.extensionElements !== undefined && (!Array.isArray(profile.extensionElements) || profile.extensionElements.some(name =>
      !name || typeof name !== "object" || typeof name.namespace !== "string" || name.namespace === mc ||
      typeof name.localName !== "string" || !ncName(name.localName) || Object.keys(name).some(key => !["namespace", "localName"].includes(key))))))
    throw new InvalidValueError("Invalid markup compatibility profile.");
  if (profile.understoodElements !== undefined && (!Array.isArray(profile.understoodElements) || profile.understoodElements.some(name =>
    !name || typeof name.namespace !== "string" || name.namespace === mc || !ncName(name.localName) || !Array.isArray(name.attributes) ||
    Object.keys(name).some(key => !["namespace", "localName", "attributes"].includes(key)) || name.attributes.some((attribute: ExpandedXmlName) =>
      !attribute || typeof attribute.namespace !== "string" || attribute.namespace === mc || !ncName(attribute.localName) || Object.keys(attribute).some(key => !["namespace", "localName"].includes(key)))))) throw new InvalidValueError("Invalid exact markup compatibility names.");
  return Object.freeze({
    understoodNamespaces: Object.freeze([...profile.understoodNamespaces]),
    extensionElements: Object.freeze((profile.extensionElements ?? []).map(name => Object.freeze({ ...name }))),
    understoodElements: Object.freeze((profile.understoodElements ?? []).map(name => Object.freeze({ ...name, attributes: Object.freeze(name.attributes.map((attribute: ExpandedXmlName) => Object.freeze({ ...attribute }))) })))
  });
}

export interface CompatibilityElement {
  readonly source: XmlElement;
  readonly disposition: "understood" | "opaque" | "extension";
  readonly attributes: readonly XmlAttribute[];
  readonly content: readonly CompatibilityContent[];
}
export type CompatibilityContent = CompatibilityElement | Exclude<XmlContent, XmlElement>;
export interface CompatibilityBranch {
  readonly alternateContent: XmlElement;
  readonly selected: XmlElement | undefined;
}
interface Scope { ignorable: Set<string>; process: ExpandedXmlName[]; }

function invalid(): never { throw new InvalidXmlError("Malformed markup compatibility declaration or structure."); }
function tokens(value: string): string[] {
  const result: string[] = [];
  let token = "";
  for (const char of value) {
    if (" \t\r\n".includes(char)) { if (token) result.push(token); token = ""; }
    else token += char;
  }
  if (token) result.push(token);
  return result;
}
function ncName(value: string): boolean {
  let first = true;
  for (const char of value) {
    const p = char.codePointAt(0)!;
    const start = p === 95 || (p >= 65 && p <= 90) || (p >= 97 && p <= 122) ||
      (p >= 0xc0 && p <= 0xd6) || (p >= 0xd8 && p <= 0xf6) || (p >= 0xf8 && p <= 0x2ff) ||
      (p >= 0x370 && p <= 0x37d) || (p >= 0x37f && p <= 0x1fff) || (p >= 0x200c && p <= 0x200d) ||
      (p >= 0x2070 && p <= 0x218f) || (p >= 0x2c00 && p <= 0x2fef) || (p >= 0x3001 && p <= 0xd7ff) ||
      (p >= 0xf900 && p <= 0xfdcf) || (p >= 0xfdf0 && p <= 0xfffd) || (p >= 0x10000 && p <= 0xeffff);
    if (!start && (first || !(p === 45 || p === 46 || p === 0xb7 || (p >= 48 && p <= 57) ||
      (p >= 0x300 && p <= 0x36f) || (p >= 0x203f && p <= 0x2040)))) return false;
    first = false;
  }
  return !first;
}
function namespaces(element: XmlElement, value: string): string[] {
  return tokens(value).map(prefix => {
    const uri = element.namespaces.get(prefix);
    if (!ncName(prefix) || !uri || uri === mc) invalid();
    return uri;
  });
}
function pairs(element: XmlElement, value: string, ignorable: Set<string>): ExpandedXmlName[] {
  return tokens(value).map(token => {
    const parts = token.split(":");
    if (parts.length !== 2 || !ncName(parts[0]!) || (parts[1] !== "*" && !ncName(parts[1]!))) invalid();
    const namespace = element.namespaces.get(parts[0]!);
    if (!namespace || namespace === mc || !ignorable.has(namespace)) invalid();
    return { namespace, localName: parts[1]! };
  });
}
function matches(name: ExpandedXmlName, pair: ExpandedXmlName): boolean {
  return name.namespace === pair.namespace && (pair.localName === "*" || name.localName === pair.localName);
}

export class MarkupCompatibility {
  readonly content: readonly CompatibilityContent[];
  readonly branches: readonly CompatibilityBranch[];
  readonly #editable = new Set<XmlContent | XmlAttribute>();

  constructor(root: XmlElement, profile: CompatibilityProfile = documentCompatibilityProfile, budget = new DocumentBudget()) {
    const settings = compatibilitySettings(profile);
    const understood = new Set(settings.understoodNamespaces);
    const branches: CompatibilityBranch[] = [];
    const attribute = (element: XmlElement, name: string) => element.attributes.find(a => a.namespace === mc && a.localName === name)?.value;
    const scopeFor = (element: XmlElement, parent: Scope): Scope => {
      budget.charge("work", 1 + parent.ignorable.size + parent.process.length * (element.attributes.length + 1) +
        element.attributes.reduce((sum, a) => sum + a.name.length + a.value.length * 8, 0));
      budget.charge("retainedBytes", (parent.ignorable.size + parent.process.length + element.attributes.length) * 16);
      const ignorable = new Set([...parent.ignorable, ...namespaces(element, attribute(element, "Ignorable") ?? "")]);
      const process = [...parent.process, ...pairs(element, attribute(element, "ProcessContent") ?? "", ignorable)];
      // Older producers use these hints. Exact source preservation exceeds their request.
      pairs(element, attribute(element, "PreserveElements") ?? "", ignorable);
      pairs(element, attribute(element, "PreserveAttributes") ?? "", ignorable);
      for (const a of element.attributes) if (a.namespace === mc &&
        !["Ignorable", "ProcessContent", "MustUnderstand", "PreserveElements", "PreserveAttributes"].includes(a.localName)) invalid();
      return { ignorable, process };
    };
    const mustUnderstand = (element: XmlElement): void => {
      if (namespaces(element, attribute(element, "MustUnderstand") ?? "").some(uri => !understood.has(uri)))
        throw new UnsupportedProfileError("A required namespace is not understood by the declared profile.");
    };
    const controlAttributes = (element: XmlElement, scope: Scope): void => {
      for (const a of element.attributes) {
        if (a.namespace === xmlns || a.namespace === mc) continue;
        if (!a.namespace && a.localName === "Requires" && element.localName === "Choice") continue;
        if (!a.namespace || a.namespace === xml || !scope.ignorable.has(a.namespace)) invalid();
      }
    };
    const opaque = (element: XmlElement): CompatibilityElement => {
      budget.charge("work", 1 + element.content.length);
      return Object.freeze({
        source: element, disposition: "extension", attributes: element.attributes,
        content: Object.freeze(element.content.map(node => node.kind === "element" ? opaque(node) : node))
      });
    };
    const visitContent = (element: XmlElement, scope: Scope, blocked: boolean): CompatibilityContent[] => {
      const result: CompatibilityContent[] = [];
      for (const node of element.content) {
        budget.charge("work", 1);
        if (node.kind === "element") result.push(...visit(node, scope, blocked, element));
        else { result.push(node); if (!blocked) this.#editable.add(node); }
      }
      return result;
    };
    const visit = (element: XmlElement, parent: Scope, blocked: boolean, owner?: XmlElement): CompatibilityContent[] => {
      const exact = settings.understoodElements!.find(name => matches(element, name));
      const exactAttribute = (attribute: XmlAttribute) => exact?.attributes.some(name => matches(attribute, name)) === true;
      const dimensions = drawingNamespaces.includes(element.namespace) && element.localName === "ext" && owner?.namespace === element.namespace && owner.localName === "xfrm" && !element.children.length && element.content.every(node => node.kind === "text" && !node.text.trim()) && ["cx", "cy"].every(name => element.attributes.filter(attribute => attribute.namespace === "" && attribute.localName === name).length === 1) && element.attributes.every(attribute => attribute.namespace === xmlns || attribute.namespace === "" && ["cx", "cy"].includes(attribute.localName) && attribute.value.length > 0 && [...attribute.value].every(char => "0123456789".includes(char)) && Number.isSafeInteger(Number(attribute.value)) && Number(attribute.value) > 0);
      if (!dimensions && settings.extensionElements!.some(name => matches(element, name))) return [opaque(element)];
      const scope = scopeFor(element, parent);
      if (scope.ignorable.has(element.namespace) && !understood.has(element.namespace) && !exact) {
        if (!scope.process.some(pair => matches(element, pair))) return [];
        if (element.attributes.some(a => a.namespace === xml && ["base", "lang", "space"].includes(a.localName))) invalid();
        mustUnderstand(element);
        return visitContent(element, scope, true);
      }
      if (element.namespace === mc) {
        if (element.localName !== "AlternateContent") invalid();
        controlAttributes(element, scope);
        let count = 0;
        let fallback = false;
        let selected: XmlElement | undefined;
        let selectedScope = scope;
        for (const node of element.content) {
          if (node.kind !== "element") {
            if ((node.kind === "text" || node.kind === "cdata") && tokens(node.text).length) invalid();
            continue;
          }
          if (settings.extensionElements!.some(name => matches(node, name)))
            throw new UnsupportedProfileError("An alternate-content extension survives compatibility processing.");
          const childScope = scopeFor(node, scope);
          if (node.namespace !== mc) {
            if (!childScope.ignorable.has(node.namespace)) invalid();
            if (understood.has(node.namespace) || childScope.process.some(pair => matches(node, pair)))
              throw new UnsupportedProfileError("An alternate-content extension survives compatibility processing.");
            continue;
          }
          controlAttributes(node, childScope);
          if (node.localName === "Choice") {
            if (fallback) invalid();
            count++;
            const requires = node.attributes.find(a => !a.namespace && a.localName === "Requires");
            if (!requires) invalid();
            const required = namespaces(node, requires.value);
            if (!required.length) invalid();
            if (!selected && required.every(uri => understood.has(uri))) { selected = node; selectedScope = childScope; }
          } else if (node.localName === "Fallback") {
            if (!count || fallback) invalid();
            fallback = true;
            if (!selected) { selected = node; selectedScope = childScope; }
          } else invalid();
        }
        if (!count) invalid();
        mustUnderstand(element);
        branches.push(Object.freeze({ alternateContent: element, selected }));
        if (!selected) return [];
        mustUnderstand(selected);
        return visitContent(selected, selectedScope, true);
      }
      mustUnderstand(element);
      const known = understood.has(element.namespace) || exact !== undefined;
      const pairedImage = drawingNamespaces.includes(element.namespace) && element.localName === "blip" &&
        element.children.some(child => child.namespace === element.namespace && child.localName === "extLst");
      const protectedContent = blocked || !known || pairedImage;
      const attributes = element.attributes.filter(a => a.namespace !== mc &&
        !(scope.ignorable.has(a.namespace) && !understood.has(a.namespace) && !exactAttribute(a)));
      if (!protectedContent) {
        this.#editable.add(element);
        for (const a of attributes) if (a.namespace !== xmlns && (exact ? a.namespace === xml && ["lang", "space"].includes(a.localName) || exactAttribute(a) : !a.namespace || a.namespace === xml || understood.has(a.namespace))) this.#editable.add(a);
      }
      return [Object.freeze({ source: element, disposition: known ? "understood" : "opaque",
        attributes: Object.freeze(attributes), content: Object.freeze(visitContent(element, scope, protectedContent)) })];
    };
    this.content = Object.freeze(visit(root, { ignorable: new Set(), process: [] }, false));
    this.branches = Object.freeze(branches);
  }

  canEdit(node: XmlContent | XmlAttribute): boolean { return this.#editable.has(node); }
}

export function hasCompatibilityMarkup(element: XmlElement, profile: CompatibilityProfile): boolean {
  return profile.extensionElements!.some(name => matches(element, name)) || element.namespace === mc || element.attributes.some(a => a.namespace === mc) ||
    (drawingNamespaces.includes(element.namespace) && element.localName === "blip" &&
      element.children.some(child => child.namespace === element.namespace && child.localName === "extLst"));
}
