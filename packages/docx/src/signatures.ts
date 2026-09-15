import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { archiveSettings, InputTypeError, type ArchiveContext } from "./archive.js";
import { validateDocxInvocation } from "./command.js";
import { signatureContentTypes, signatureRelationshipTypes } from "./document-part-roles.js";
import { encodeLocation, SelectionError, type Location } from "./location-token.js";
import { asciiKey } from "./part-uri.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";
import { publishDocumentArchive, type PublicationContext, type PublicationInput } from "./publication.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import type { DocumentBudget } from "./budget.js";

export interface SignatureRelationship {
 readonly owner: string; readonly id: string; readonly type: string;
 readonly target: string | null; readonly external: boolean;
}
export interface SignatureListData {
 readonly items: readonly { readonly name: string; readonly kind: "signatures"; readonly location: Location<"part">;
  readonly support: "read"; readonly properties: readonly []; readonly references: readonly [];
  readonly details: { readonly kind: "signatures"; readonly role: "origin" | "signature" | "certificate" | "relationship-target"; readonly verified: null } }[];
 readonly relationships: readonly SignatureRelationship[]; readonly verified: null;
}
export interface SignatureMutationData {
 readonly changed: boolean; readonly dryRun: boolean; readonly removedParts: readonly string[];
 readonly removedRelationships: readonly SignatureRelationship[];
 readonly removedContentTypes: readonly { readonly kind: "default" | "override"; readonly name: string; readonly contentType: string }[];
 readonly output: { readonly path: string | null; readonly bytes: number; readonly sha256: string } | null;
}
export interface SignatureMutationContext extends PublicationContext {
 readonly admitPublication?: (data: SignatureMutationData) => undefined;
}
export type SignatureRemoveOptions = DocxOperationArguments<"signatures.remove"> & { readonly input?: PublicationInput };
const relationshipsType = "application/vnd.openxmlformats-package.relationships+xml";
function relationshipPart(owner: string): string {
 if (owner === "/") return "/_rels/.rels";
 const slash = owner.lastIndexOf("/");
 return owner.slice(0, slash + 1) + "_rels/" + owner.slice(slash + 1) + ".rels";
}
function signatureGraph(archive: AdmittedDocumentArchive, budget: DocumentBudget) {
 const parts = new Set(archive.package.parts.filter(part => signatureContentTypes.includes(asciiKey(part.content_type))).map(part => part.partname));
 const all: SignatureRelationship[] = [], relationships: SignatureRelationship[] = [];
 for (const owner of ["/", ...archive.package.parts.filter(part => asciiKey(part.content_type) !== relationshipsType).map(part => part.partname)]) {
  for (const edge of archive.package.relationships(owner)) {
   budget.charge("work", 1); budget.charge("retainedBytes", 192 + owner.length * 2 + edge.rId.length * 2 + edge.reltype.length * 2);
   const reference = { owner, id: edge.rId, type: edge.reltype, target: edge.is_external ? null : edge.target_part.partname, external: edge.is_external };
   all.push(reference);
   if (signatureRelationshipTypes.includes(edge.reltype)) {
    relationships.push(reference);
    if (reference.target !== null) parts.add(reference.target);
   }
  }
 }
 budget.check("matches", parts.size + relationships.length);
 return { parts, all, relationships };
}

/** Inventories declared OPC structures; payloads are not cryptographically evaluated. */
export async function inspectDocumentSignatures(input: Uint8Array, options: DocxOperationArguments<"signatures.list">, context: ArchiveContext): Promise<SignatureListData> {
 const settings = archiveSettings(context);
 const invocation = validateDocxInvocation({operation:"signatures.list",inputs:["document"],options},settings.budget);
 const budget = settings.budget.lower(Object.fromEntries((invocation.options.limit as DocxOperationArguments<"signatures.list">["limit"] ?? []).map(limit=>[limit.name,limit.value])));
 if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected archive bytes.");
 budget.check("compressedInput",input.length); budget.charge("retainedBytes",input.length);
 const ownedInput=new Uint8Array(input);
 const archive = await readDocumentArchive(ownedInput,{...settings,budget}), graph = signatureGraph(archive,budget);
 budget.charge("work", input.length);
 const sourceSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256",ownedInput))].map(value=>value.toString(16).padStart(2,"0")).join("");
 const items: SignatureListData["items"][number][] = [];
 for(const part of archive.package.parts) if(graph.parts.has(part.partname)) {
  const value = {version:1 as const,sourceSha256,generation:0,part:part.partname,story:part.partname,path:[],range:null};
  const location: Location<"part"> = {kind:"part",value,token:encodeLocation(value),positions:{}};
  budget.charge("retainedBytes",location.token.length * 4 + 256);
  const index = signatureContentTypes.indexOf(asciiKey(part.content_type));
  const role = (["origin","signature","certificate"] as const)[index] ?? "relationship-target";
  items.push({name:part.partname,kind:"signatures",location,support:"read",properties:[],references:[],details:{kind:"signatures",role,verified:null}});
 }
 const data: SignatureListData = {items,relationships:graph.relationships,verified:null};
 measurePackageResourceSerialization(data,budget);
 return data;
}

/** Removes only an isolated, declared signature graph as a separate explicit operation. */
export async function stripDocumentSignatures(input: Uint8Array, options: SignatureRemoveOptions, context: SignatureMutationContext): Promise<SignatureMutationData> {
 const settings=archiveSettings(context), {input:identity,...operationOptions}=options;
 const invocation=validateDocxInvocation({operation:"signatures.remove",inputs:[identity?.path ?? "document"],options:operationOptions},settings.budget);
 const opts=invocation.options as DocxOperationArguments<"signatures.remove">;
 const budget=settings.budget.lower(Object.fromEntries((opts.limit ?? []).map(limit=>[limit.name,limit.value])));
 const archive=await readDocumentArchive(input,{...settings,budget}), graph=signatureGraph(archive,budget);
 if(!graph.parts.size && !graph.relationships.length && !opts.allowEmpty) throw new SelectionError("missing-selection",[]);
 if(archive.package.parts.some(part=>graph.parts.has(part.partname) && (part.partname===archive.mainPart || asciiKey(part.content_type).startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml.")))) throw new UnsupportedEditError("Signature graph overlaps the document owner.");
 for(const edge of graph.all) {
  if(signatureRelationshipTypes.includes(edge.type)) continue;
  if(graph.parts.has(edge.owner) || edge.target !== null && graph.parts.has(edge.target)) throw new UnsupportedEditError("Signature graph has unsupported or shared relationships.");
 }
 const removedRelationships=graph.all.filter(edge=>signatureRelationshipTypes.includes(edge.type) || graph.parts.has(edge.owner));
 const removed = new Set(graph.parts);
 const ownedRelationshipNames=new Set([...graph.parts].map(owner=>asciiKey(relationshipPart(owner))));
 for(const part of archive.package.parts) if(ownedRelationshipNames.has(asciiKey(part.partname))) removed.add(part.partname);
 const removedParts=archive.package.parts.filter(part=>removed.has(part.partname)).map(part=>part.partname);
 const removedContentTypes: SignatureMutationData["removedContentTypes"][number][]=[];
 const relationshipsByPart=new Map<string,Set<string>>();
 for(const edge of removedRelationships) {
  const name=asciiKey(relationshipPart(edge.owner)), ids=relationshipsByPart.get(name) ?? new Set<string>();
  ids.add(edge.id); relationshipsByPart.set(name,ids);
 }
 const memberPartNames=new Map(archive.package.parts.map(part=>[part.name,part.partname]));
 const members=archive.members.filter(member=>!removed.has(memberPartNames.get(member.name) ?? "")).map(member=>{
  if(member.directory) return member;
  const partname=memberPartNames.get(member.name) ?? "/[Content_Types].xml";
  if(asciiKey(partname)==="/[content_types].xml") {
   const editor=new DocumentXmlEditor(member.bytes,{},undefined,budget);
   for(const node of editor.root.children) {
    const attribute=(name:string)=>node.attributes.find(value=>!value.namespace && value.localName===name)?.value;
    const contentType=attribute("ContentType")!;
    const name=attribute(node.localName==="Override" ? "PartName" : "Extension")!;
    const drop=node.localName==="Override" ? removed.has(archive.package.getPart(name).partname) : signatureContentTypes.includes(asciiKey(contentType));
    if(drop) { removedContentTypes.push({kind:node.localName==="Override" ? "override" : "default",name,contentType}); editor.replaceElement(node,""); }
   }
   return {...member,bytes:editor.serialize()};
  }
  const edges=relationshipsByPart.get(asciiKey(partname));
  if(!edges?.size) return member;
  const editor=new DocumentXmlEditor(member.bytes,{},undefined,budget);
  for(const node of editor.root.children) if(edges.has(node.attributes.find(attribute=>!attribute.namespace && attribute.localName==="Id")!.value)) editor.replaceElement(node,"");
  return {...member,bytes:editor.serialize()};
 });
 const planned: SignatureMutationData={changed:removedParts.length+removedRelationships.length+removedContentTypes.length>0,dryRun:opts.dryRun ?? false,removedParts,removedRelationships,removedContentTypes,output:opts.dryRun ? null : {path:opts.inPlace ? identity?.path ?? null : opts.output ?? null,bytes:settings.limits.maxArchiveBytes,sha256:"0".repeat(64)}};
 measurePackageResourceSerialization(planned,budget);
 if(context.admitPublication) {
  const result=context.admitPublication(planned);
  if(result!==undefined) { if(result && typeof (result as Promise<unknown>).then==="function") void Promise.resolve(result).catch(()=>{}); throw new InputTypeError("Signature publication admission must be synchronous."); }
 }
 const publicationOptions={...(opts.output === undefined ? {} : {output:opts.output}),...(opts.inPlace === undefined ? {} : {inPlace:opts.inPlace}),...(opts.force === undefined ? {} : {force:opts.force}),...(opts.dryRun === undefined ? {} : {dryRun:opts.dryRun}),...(opts.json === undefined ? {} : {json:opts.json})};
 const candidate={...archive,members};
 const published=await publishDocumentArchive(candidate,{...publicationOptions,...(identity ? {input:identity} : {})},{...context,budget},candidate);
 return {...planned,output:published.published.length ? {path:published.published[0]!.path,bytes:published.published[0]!.bytes,sha256:published.archiveSha256!} : null};
}
