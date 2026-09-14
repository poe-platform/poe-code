import { sanitizeProperties } from "./properties.js";
import { readPackage } from "./package-reader.js";
import { parseXmlPart } from "./xml.js";
import type { BinaryInput } from "./contracts.js";
import { parseContentTypes } from "./content-types.js";
import { OfficeError } from "./errors.js";
import { attr, invalid, loadShared, relPart } from "./masters.js";
import type { RelationshipEdge } from "./relationships.js";
import type { SelectionContext } from "./selectors.js";
import type { XmlElement, XmlPart } from "./xml.js";

export type SanitizeCategory = "notes" | "comments" | "properties" | "links" | "objects";
export interface SanitizeOptions {
  readonly remove: readonly SanitizeCategory[];
  readonly allowEmpty?: boolean;
}
export interface SanitizeEntry {
  readonly category: SanitizeCategory | "resources" | "unknown";
  readonly kind: "part" | "relationship" | "element";
  readonly part: string;
  readonly reason: string;
  readonly relationshipId?: string;
  readonly target?: string;
}
export interface SanitizeResult {
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly removed: readonly SanitizeEntry[];
  readonly retained: readonly SanitizeEntry[];
  readonly warnings: readonly string[];
}
const namespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
const modern = "http://schemas.microsoft.com/office/2018/10/relationships";
function category(edge: RelationshipEdge): SanitizeCategory | undefined {
  for (const ns of namespaces) {
    if ([`${ns}/notesSlide`, `${ns}/notesMaster`].includes(edge.type)) return "notes";
    if ([`${ns}/comments`, `${ns}/commentAuthors`].includes(edge.type)) return "comments";
    if ([`${ns}/extended-properties`, `${ns}/custom-properties`].includes(edge.type)) return "properties";
    if ([`${ns}/oleObject`, `${ns}/package`].includes(edge.type)) return "objects";
    if (edge.type === `${ns}/hyperlink` && edge.external) return "links";
  }
  if ([`${modern}/comments`, `${modern}/authors`].includes(edge.type)) return "comments";
  if (edge.type === "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties") return "properties";
  return undefined;
}
function walk(root: XmlElement): {node: XmlElement; parent?: XmlElement; ancestors: XmlElement[]}[] {
  const result: {node:XmlElement; parent?:XmlElement; ancestors:XmlElement[]}[]=[];
  const pending=[{node:root,ancestors:[] as XmlElement[]}];
  while(pending.length) {
    const entry=pending.pop()!;
    result.push({...entry, ...(entry.ancestors.length ? {parent:entry.ancestors.at(-1)!}: {})});
    for(const node of [...entry.node.children].reverse()) pending.push({node,ancestors:[...entry.ancestors,entry.node]});
  }
  return result;
}
function references(node:XmlElement, id:string) {
  return node.attributes.some(a=>namespaces.includes(a.name.namespace) && a.value===id);
}
function isDrawing(node:XmlElement, names:readonly string[]) {
  return ["http://schemas.openxmlformats.org/drawingml/2006/main","http://purl.oclc.org/ooxml/drawingml/main"].includes(node.name.namespace) && names.includes(node.name.localName);
}
function isPresentation(node:XmlElement, names:readonly string[]) {
  return ["http://schemas.openxmlformats.org/presentationml/2006/main","http://purl.oclc.org/ooxml/presentationml/main"].includes(node.name.namespace) && names.includes(node.name.localName);
}
export async function sanitize(input:BinaryInput, options:SanitizeOptions, context:SelectionContext):Promise<SanitizeResult> {
  if (!options || typeof options!=="object" || ![Object.prototype,null].includes(Object.getPrototypeOf(options)) ||
    Object.keys(options).some(k=>!["remove","allowEmpty"].includes(k)) || !Array.isArray(options.remove) || !options.remove.length ||
    options.remove.some(k=>!["notes","comments","properties","links","objects"].includes(k)) ||
    new Set(options.remove).size!==options.remove.length || (options.allowEmpty!==undefined && typeof options.allowEmpty!=="boolean")) invalid("An explicit nonempty sanitization policy is required.");
  const s=await loadShared(input,context);
  const edges=s.index.inventory.relationships;
  const removed:SanitizeEntry[]=[], retained:SanitizeEntry[]=[];
  const cut=new Set<RelationshipEdge>();
  const candidates=new Map<string,SanitizeCategory|"resources">();
  const types=parseContentTypes(s.reader.get("/[Content_Types].xml"),{...context.xmlLimits,maxEntries:context.archiveLimits.maxMembers});
  const isXml=(part:string)=> {const type=types.get(part).split(";",1)[0]!.trim(); return type.endsWith("+xml") || type==="application/xml" || type==="text/xml";};
  if(options.remove.includes("properties")) {
    const cleaned=await readPackage((await sanitizeProperties(s.source,context)).bytes,context);
    for(const edge of edges.filter(e=>category(e)==="properties" && e.targetPart)) {
      const part=edge.targetPart!;
      const before=s.doc(part), after=parseXmlPart(cleaned.get(part),context.xmlLimits);
      if(before.markup(before.root,true)===after.markup(after.root,true)) continue;
      const remaining=after.root.children.map(node=>after.markup(node,true));
      for(const node of before.root.children) {
        const markup=before.markup(node,true),at=remaining.indexOf(markup);
        if(at>=0) remaining.splice(at,1);
        else removed.push({category:"properties",kind:"element",part,reason:`Supported scalar property removed: {${node.name.namespace}}${node.name.localName}.`});
      }
      s.save(part,after);
    }
  }
  const retainedNotes=edges.some(edge=>edge.type===`${s.r}/notesSlide` && edge.targetPart &&
    (edges.some(incoming=>incoming.targetPart===edge.targetPart && incoming.type!==`${s.r}/notesSlide`) ||
      (edge.owner!=="/" && isXml(edge.owner) && walk(s.doc(edge.owner).root).some(({node})=>references(node,edge.id)))));
  for(const edge of edges) {
    context.signal?.throwIfAborted();
    const selected=category(edge);
    if(!selected || selected==="properties" || !options.remove.includes(selected)) continue;
    if(retainedNotes && edge.type===`${s.r}/notesMaster`) continue;
    if(edge.type===`${s.r}/notesSlide` && edge.targetPart && edges.some(incoming=>incoming.targetPart===edge.targetPart && incoming.type!==`${s.r}/notesSlide`)) {
      retained.push({category:"notes",kind:"relationship",part:edge.owner,relationshipId:edge.id,target:edge.target,reason:"Shared notes retain their reciprocal slide and master associations."});
      continue;
    }
    let doc:XmlPart|undefined;
    if(edge.owner!=="/" && isXml(edge.owner)) doc=s.doc(edge.owner);
    const refs=doc ? walk(doc.root).filter(({node})=>references(node,edge.id)) : [];
    if(selected==="objects" && (!doc || !isPresentation(doc.root,["sld","sldLayout","sldMaster","notes","notesMaster"]) || !refs.length)) {
      retained.push({category:selected,kind:"relationship",part:edge.owner,relationshipId:edge.id,target:edge.target,reason:"Embedded resource belongs to retained content or an unsupported consumer."});
      continue;
    }
    const targets:XmlElement[]=[];
    let safe=true;
    for(const entry of refs) {
      if(selected==="links" && isDrawing(entry.node,["hlinkClick","hlinkHover","hlinkMouseOver"])) targets.push(entry.node);
      else if(selected==="notes" && isPresentation(entry.node,["notesMasterId"])) targets.push(entry.parent && isPresentation(entry.parent,["notesMasterIdLst"]) && entry.parent.children.length===1 ? entry.parent : entry.node);
      else if(selected==="objects" && isPresentation(entry.node,["oleObj"])) {
        const frame=[...entry.ancestors].reverse().find(node=>isPresentation(node,["graphicFrame"]));
        if(frame) targets.push(frame); else safe=false;
      } else safe=false;
    }
    if(!safe) {
      retained.push({category:selected,kind:"relationship",part:edge.owner,relationshipId:edge.id,target:edge.target,reason:"Unsupported relationship consumer retained with its target."});
      continue;
    }
    if(doc) {
      const original=doc;
      const paths=walk(original.root).filter(({node,ancestors})=>targets.includes(node) && !ancestors.some(a=>targets.includes(a))).map(({node,ancestors})=> {
        let current=original.root;
        return [...ancestors.slice(1),node].map(next=> {const at=current.children.indexOf(next); current=next; return at;});
      });
      for(const path of paths.reverse()) {
        let parent=doc.root;
        for(const at of path.slice(0,-1)) parent=parent.children[at]!;
        doc=doc.spliceChildren(parent,path.at(-1)!,1,[]);
        removed.push({category:selected,kind:"element",part:edge.owner,relationshipId:edge.id,reason:"Selected relationship consumer removed; adjacent content retained."});
      }
      if(doc!==original) s.save(edge.owner,doc);
    }
    cut.add(edge);
    if(edge.targetPart) candidates.set(edge.targetPart,selected);
  }
  // Only resources reached from selected roots can become deletion candidates.
  const protectedParts=new Set([s.main,...s.index.inventory.slides.map(x=>x.part),...s.index.inventory.masters,...s.index.inventory.layouts,...s.index.inventory.themes]);
  const pending=[...candidates.keys()];
  while(pending.length) {
    const owner=pending.pop()!;
    for(const edge of edges.filter(e=>e.owner===owner && !e.external)) {
      if(edge.targetPart && (category(edge)==="notes" || namespaces.some(ns=>[`${ns}/image`,`${ns}/audio`,`${ns}/video`].includes(edge.type))) && !protectedParts.has(edge.targetPart) && !candidates.has(edge.targetPart)) {
        candidates.set(edge.targetPart,"resources"); pending.push(edge.targetPart);
      }
    }
  }
  const deletable=new Set([...candidates.keys()].filter(part=>!protectedParts.has(part)));
  let changed=true;
  while(changed) {
    changed=false;
    for(const part of deletable) if(edges.some(e=>e.targetPart===part && !cut.has(e) && !deletable.has(e.owner))) {deletable.delete(part); changed=true;}
  }
  const retainedComments=edges.some(e=>category(e)==="comments" && e.type.endsWith("/comments") && e.targetPart && !deletable.has(e.targetPart));
  if(retainedComments) {
    for(const edge of [...cut]) if(edge.type.endsWith("/authors") || edge.type.endsWith("/commentAuthors")) {
      cut.delete(edge);
      if(edge.targetPart) deletable.delete(edge.targetPart);
    }
    changed=true;
    while(changed) {
      changed=false;
      for(const part of deletable) if(edges.some(e=>e.targetPart===part && !cut.has(e) && !deletable.has(e.owner))) {deletable.delete(part); changed=true;}
    }
  }
  for(const edge of cut) {
    const ownerRel=edge.owner==="/" ? "/_rels/.rels" : relPart(edge.owner);
    const doc=s.doc(ownerRel);
    const at=doc.root.children.findIndex(n=>attr(n,"Id")===edge.id);
    if(at>=0) s.save(ownerRel,doc.spliceChildren(doc.root,at,1,[]));
    removed.push({category:category(edge)!,kind:"relationship",part:edge.owner,relationshipId:edge.id,target:edge.target,reason:"Selected relationship removed."});
  }
  for(const part of deletable) {
    s.deleted.add(part);
    if(s.reader.has(relPart(part))) s.deleted.add(relPart(part));
    removed.push({category:candidates.get(part)!,kind:"part",part,reason:"Selected part or exclusively owned dependency removed."});
  }
  if(deletable.size) {
    let doc=s.doc("/[Content_Types].xml");
    for(let at=doc.root.children.length-1;at>=0;at--) if(deletable.has(attr(doc.root.children[at]!,"PartName")??"")) doc=doc.spliceChildren(doc.root,at,1,[]);
    s.save("/[Content_Types].xml",doc);
  }
  for(const part of s.reader.names.filter(n=>!s.deleted.has(n))) {
    retained.push({category:candidates.get(part)??"unknown",kind:"part",part,reason:candidates.has(part)?"Retained because shared or structurally required; may still contain selected data.":"Retained package content; hidden or unsupported data is not certified absent."});
    if(part!=="/[Content_Types].xml" && isXml(part)) for(const {node} of walk(s.doc(part).root)) {
      if(isDrawing(node,["hlinkClick","hlinkHover","hlinkMouseOver"])) retained.push({category:"links",kind:"element",part,reason:"Internal navigation or unsupported action retained inert; no activation performed."});
    }
  }
  for(const edge of edges.filter(e=>e.external && !cut.has(e) && !s.deleted.has(e.owner))) retained.push({category:category(edge)??"unknown",kind:"relationship",part:edge.owner,relationshipId:edge.id,target:edge.target,reason:"External relationship retained; unsupported consumers and non-hyperlink resources are preserve-only."});
  if(!removed.length && !options.allowEmpty) throw new OfficeError("missing-selection","No removable content matched the explicit policy.","select");
  return {bytes:removed.length?(await s.finish(s.main,[])).bytes:s.source,affected:removed.filter(entry=>entry.category==="properties" && entry.kind==="element").length + [...cut].filter(edge=>!edge.type.endsWith("/notesMaster") && !edge.type.endsWith("/authors") && !edge.type.endsWith("/commentAuthors")).length,removed,retained,warnings:["Only explicitly selected supported content was removed. Retained content may contain hidden data; no clean-file claim is made."]};
}
