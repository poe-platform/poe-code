import { archiveSettings, type ArchiveContext } from './archive.js';
import { validateDocxInvocation } from './command.js';
import { documentDialects, dialectForNamespace } from './dialect.js';
import type { InspectionReference } from './inspection.js';
import type { StoryReference } from './location-index.js';
import { closedRecord, encodeLocation, SelectionError, type Location } from './location-token.js';
import { openDocumentLocations } from './locations.js';
import type { DocxOperationArguments } from './operation-types.js';
import { paragraphTextRun } from './paragraph-content.js';
import { DocumentArchiveEditor } from './package-write.js';
import { assertDocumentEditable, publishDocumentArchive, type PublicationInput, type PublicationContext } from './publication.js';
import { resolveDocxSelection } from './simple-selection.js';
import { UnsupportedEditError } from './xml-write.js';
import type { XmlElement } from './package-xml.js';
import { runElementOpen } from './run-properties.js';
import { measurePackageResourceSerialization } from './ancillary-resources.js';
export interface ShapeRecord {
 readonly kind:'shape'; readonly location:Location<'shape'>; readonly name?:string; readonly properties:readonly [];
 readonly references:readonly InspectionReference[]; readonly support:'edit'|'preserve';
 readonly details:{readonly representation:'native'|'office'|'vml';readonly kind:'shape'|'group';readonly containingGroup:Location<'shape'>|null;readonly textBoxStories:readonly Location<'story'>[];readonly ownerPart:string;readonly sectionReferences:readonly StoryReference[];readonly refusalReasons:readonly string[];readonly watermarkEvidence:readonly string[];readonly editSupport:'supported'|'unsupported'};
}
export interface ShapeInspectionData {readonly items:readonly ShapeRecord[];readonly warnings:readonly {readonly code:string;readonly message:string}[]}
export interface ShapeEditRequest {readonly operation:'shapes.set';readonly options:DocxOperationArguments<'shapes.set'>;readonly input?:PublicationInput}
export interface ShapeEditData {readonly changed:boolean;readonly changes:readonly {readonly kind:'replace';readonly before:Location;readonly after:Location}[];readonly output:{readonly path:string|null;readonly bytes:number;readonly sha256:string}|null;readonly dryRun:boolean}
export interface ShapeEditContext extends PublicationContext {readonly admitPublication?:(planned:ShapeEditData)=>undefined}
function plainParagraph(body: XmlElement, w: string): XmlElement | undefined {
 const clean = (node: XmlElement) => node.content.every(n => n.kind === 'element' || n.kind === 'text' && !n.text.trim());
 const pNames = ['pStyle','bidi','jc','spacing','ind','keepNext','keepLines','pageBreakBefore','widowControl','outlineLvl','tabs'];
 const rNames = ['b','i','u','color','sz','szCs','bCs','iCs','rtl','vanish','rFonts','lang','rStyle','highlight','strike','dstrike','caps','smallCaps','vertAlign'];
 const properties = (node: XmlElement, names: string[]) => clean(node) && node.children.every(n => n.namespace === w && names.includes(n.localName) && clean(n) && (n.localName === 'tabs' ? n.children.every(t => t.namespace === w && t.localName === 'tab' && !t.children.length && clean(t)) : !n.children.length));
 if (!clean(body) || body.children.length !== 1) return undefined;
 const p = body.children[0]!;
 if(p.namespace !== w || p.localName !== 'p' || !clean(p)) return undefined;
 if(p.children.filter(n => n.localName === 'pPr').length > 1 || p.children.some((n,i) => n.localName === 'pPr' && i !== 0)) return undefined;
 for(const n of p.children) {
  if(n.namespace !== w) return undefined;
  if(n.localName === 'pPr') { if(!properties(n,pNames)) return undefined; continue; }
  if(n.localName !== 'r' || !clean(n) || n.children.filter(c=>c.localName === 'rPr').length > 1) return undefined;
  for(let i=0;i<n.children.length;i++) {
   const c=n.children[i]!;
   if(c.namespace !== w) return undefined;
   if(c.localName === 'rPr') { if(i !== 0 || !properties(c,rNames))return undefined; }
   else if(c.localName === 't') { if(c.children.length || c.content.some(t=>t.kind !== 'text' && t.kind !== 'cdata')) return undefined; }
   else if(!['tab','br','cr'].includes(c.localName) || c.content.length) return undefined;
  }
 }
 return p;
}
/** Inventories logical carriers and explicit non-rendering support evidence. */
export async function inspectDocumentShapes(input:Uint8Array, options:DocxOperationArguments<'shapes.list'>, context:ArchiveContext):Promise<ShapeInspectionData> {
 const settings=archiveSettings(context), invocation=validateDocxInvocation({operation:'shapes.list',inputs:['document'],options},settings.budget);
 const opts=invocation.options as DocxOperationArguments<'shapes.list'>;
 const budget=settings.budget.lower(Object.fromEntries((opts.limit??[]).map(item=>[item.name,item.value])));
 const document=await openDocumentLocations(input,{...settings,budget},'inventory');
 const all=document.list('shape',{scope:'all-stories'});
 const headerShapes=new Set(document.list('shape',{scope:'headers'}).map(location=>location.token));
 const selected=resolveDocxSelection(document,invocation);
 const items:ShapeRecord[]=selected.map(location=> {
  const carrier=document.shapeCarrier(location.token);
  const containingGroup=carrier.group ? all.find(candidate=>document.shapeCarrier(candidate.token).node===carrier.group)??null : null;
  const name=carrier.node.attributes.find(a=>!a.namespace && a.localName==='id')?.value;
  const stories=document.list('story',{owner:location.token});
  const plain=carrier.bodies.length===1 && plainParagraph(carrier.bodies[0]!.node,carrier.bodies[0]!.wordNamespace);
  const shared=document.references(location.token).length>1;
  const editable=carrier.support==='supported' && !!plain && !shared;
  const sectionReferences=document.references(location.token);
  const watermarkEvidence:string[]=[];
  if(headerShapes.has(location.token))watermarkEvidence.push('header-story');
  const stack=[carrier.node];while(stack.length){const node=stack.pop()!;budget.charge('work',1);if(node.namespace==='urn:schemas-microsoft-com:vml'&&node.localName==='textpath'&&!watermarkEvidence.includes('text-path-declaration'))watermarkEvidence.push('text-path-declaration');for(const child of node.children)stack.push(child);}
  const refusalReasons=[...carrier.refusalReasons,...(shared?['shared-owner']:[]),...(carrier.bodies.length && !plain?['plain-assignment-profile']:[])];
  return {kind:'shape',location:location as Location<'shape'>,...(name?{name}:{}),properties:[],references:[],support:editable?'edit':'preserve',details:{representation:carrier.representation,kind:carrier.kind,containingGroup,textBoxStories:stories,ownerPart:location.value.part,sectionReferences,refusalReasons,watermarkEvidence,editSupport:editable?'supported':'unsupported'}};
 });
 const data={items,warnings:[]}; measurePackageResourceSerialization(data,budget);return data;
}
/** Plain assignment preserves the paragraph properties and the complete carrier envelope. */
export async function editDocumentShapes(input:Uint8Array, request:ShapeEditRequest, context:ShapeEditContext):Promise<ShapeEditData> {
 closedRecord(request,['operation','options','input']);
 const settings=archiveSettings(context),invocation=validateDocxInvocation({operation:request.operation,inputs:[request.input?.path??'document'],options:request.options},settings.budget);
 const identity=request.input?{path:request.input.path,stat:{...request.input.stat}}:undefined;
 const opts=invocation.options as DocxOperationArguments<'shapes.set'>,budget=settings.budget.lower(Object.fromEntries((opts.limit??[]).map(item=>[item.name,item.value])));
 const document=await openDocumentLocations(input,{...settings,budget});
 const selected=resolveDocxSelection(document,invocation);
 const archive=document.snapshot();assertDocumentEditable(archive,{...settings,budget});
 const editor=new DocumentArchiveEditor(archive,{},undefined,budget);
 const changes:ShapeEditData['changes'][number][]=[];
 for(const before of selected) {
  if(document.references(before.token).length>1)throw new SelectionError('ambiguous-selection');
  const carrier=document.shapeCarrier(before.token);
  if(carrier.kind!=='shape'||carrier.refusalReasons.length||carrier.bodies.length!==1)throw new UnsupportedEditError('The selected shape does not admit text assignment.');
  const xml=editor.xml(before.value.part.slice(1));
  let node=xml.root;for(const index of before.value.path)node=node.children[index]!;
  xml.assertShapeEditAllowed(node);
  const bodyLocation=document.shapeStory(before.token);
  let body=xml.root;for(const index of bodyLocation.value.path)body=body.children[index]!;
  const dialect=dialectForNamespace(xml.root.namespace)!,w=documentDialects[dialect].w;
  const paragraph=plainParagraph(body,w);
  if(!paragraph)throw new UnsupportedEditError('Shape assignment requires one plain paragraph and supported properties.');
  const props=paragraph.children.find(n=>n.localName==='pPr');
  const replacement=runElementOpen(paragraph)+(props?xml.sourceXml(props):'')+paragraphTextRun(w,opts.text??'')+'</'+paragraph.name+'>';
  if(replacement===xml.sourceXml(paragraph))continue;
  xml.replaceElement(paragraph,replacement);
  const value={...before.value,generation:1};
  changes.push({kind:'replace',before,after:{...before,value,token:encodeLocation(value)}});
 }
 const candidate=editor.snapshot();
 const publication={...(identity?{input:identity}:{}),...(opts.output===undefined?{}:{output:opts.output}),...(opts.inPlace===undefined?{}:{inPlace:opts.inPlace}),...(opts.force===undefined?{}:{force:opts.force}),...(opts.dryRun===undefined?{}:{dryRun:opts.dryRun}),...(opts.json===undefined?{}:{json:opts.json})};
 const prospective:ShapeEditData={changed:!!changes.length,changes,dryRun:opts.dryRun??false,output:opts.dryRun?null:{path:opts.inPlace?identity?.path??null:opts.output==='-'?null:opts.output??null,bytes:settings.limits.maxArchiveBytes,sha256:'0'.repeat(64)}};
 measurePackageResourceSerialization(prospective,budget);context.admitPublication?.(prospective);
 const result=await publishDocumentArchive(candidate,publication,{...context,budget});
 return {...prospective,output:result.published.length?{path:result.published[0]!.path,bytes:result.published[0]!.bytes,sha256:result.archiveSha256!}:null};
}
