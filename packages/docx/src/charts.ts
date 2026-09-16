import {archiveSettings,InputTypeError,type ArchiveContext} from './archive.js';
import {readDocumentArchive} from './admission.js';
import {validateDocxInvocation} from './command.js';
import type {DocxOperationArguments} from './operation-types.js';
import {DocumentBudget} from './budget.js';
import {encodeLocation,type Location} from './location-token.js';
import {parseDocumentXml,type XmlElement} from './package-xml.js';
import type {DocumentPackage,PackagePart,PackageRelationship} from './package.js';
import type {InspectionReference,InspectionWarning} from './inspection.js';
import {decodeChartContent,type ChartIssue,type ChartSeries} from './chart-values.js';
import {measurePackageResourceSerialization} from './ancillary-resources.js';
export type {ChartIssue,ChartPoint,ChartCache,ChartSource,ChartSeries} from './chart-values.js';
export interface ChartPart {readonly name:string;readonly contentType:string;readonly bytes:number;readonly sha256:string}
export interface ChartBinding {readonly role:'workbook'|'style'|'color';readonly relationshipId:string|null;readonly reference:InspectionReference|null;readonly status:'internal'|'external'|'missing-id'|'missing-relationship'|'wrong-relationship-type'|'wrong-resource-type'|'opaque';readonly target:ChartPart|null;readonly issues:readonly ChartIssue[]}
export interface ChartExternalData {readonly path:readonly number[];readonly relationshipId:string|null;readonly autoUpdate:readonly (string|null)[];readonly binding:ChartBinding}
export interface ChartDetails {readonly kind:'charts';readonly definition:ChartPart;readonly root:{readonly namespace:string;readonly localName:string};readonly status:'decoded'|'opaque';readonly chartType:string|null;readonly chartTypes:readonly string[];readonly plotGroups:readonly {readonly type:string;readonly path:readonly number[]}[];readonly series:readonly ChartSeries[];readonly externalData:readonly ChartExternalData[];readonly workbookParts:readonly string[];readonly resources:readonly ChartBinding[];readonly graphParts:readonly ChartPart[];readonly issues:readonly ChartIssue[]}
export interface ChartRecord {readonly kind:'charts';readonly location:Location<'part'>;readonly name:string;readonly properties:readonly [];readonly references:readonly InspectionReference[];readonly support:'read'|'preserve';readonly details:ChartDetails}
export interface ChartInspectionData {readonly items:readonly ChartRecord[];readonly warnings:readonly InspectionWarning[]}
const standardMime='application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const extendedMime='application/vnd.ms-office.chartex+xml';
const definitionRelations=['http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart','http://purl.oclc.org/ooxml/officeDocument/relationships/chart','http://schemas.microsoft.com/office/2014/relationships/chartEx'];
const resourceRoles:Readonly<Record<ChartBinding['role'],{readonly types:readonly string[];readonly mimes:readonly string[]}>>={
 workbook:{types:['http://schemas.openxmlformats.org/officeDocument/2006/relationships/package','http://purl.oclc.org/ooxml/officeDocument/relationships/package'],mimes:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.spreadsheetml.template','application/vnd.ms-excel.sheet.macroenabled.12','application/vnd.ms-excel.template.macroenabled.12','application/vnd.ms-excel.sheet.binary.macroenabled.12']},
 style:{types:['http://schemas.microsoft.com/office/2011/relationships/chartStyle'],mimes:['application/vnd.ms-office.chartstyle+xml']},
 color:{types:['http://schemas.microsoft.com/office/2011/relationships/chartColorStyle'],mimes:['application/vnd.ms-office.chartcolorstyle+xml']}
};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
/** Physical definition roles are declarative package metadata, independent of drawing visibility. */
export function chartDefinitionParts(graph:DocumentPackage,budget:DocumentBudget):readonly PackagePart[] {
 const names=new Set<string>();
 for(const part of graph.parts){budget.charge('work',1);if([standardMime,extendedMime].includes(part.content_type.toLowerCase()))names.add(part.partname);}
 for(const owner of ['/',...graph.parts.filter(p=>!p.content_type.toLowerCase().endsWith('relationships+xml')).map(p=>p.partname)])for(const edge of graph.relationships(owner)){budget.charge('work',1);if(!edge.is_external&&definitionRelations.includes(edge.reltype))names.add(edge.target_part.partname);}
 budget.check('matches',names.size);budget.charge('retainedBytes',names.size*96);return [...names].sort(compare).map(name=>graph.getPart(name));
}
/** Read-only inventory of admitted physical chart definitions and inert graph resources. */
export async function inspectDocumentCharts(input:Uint8Array,options:DocxOperationArguments<'charts.list'>,context:ArchiveContext):Promise<ChartInspectionData> {
 const settings=archiveSettings(context),invocation=validateDocxInvocation({operation:'charts.list',inputs:['document'],options},settings.budget);
 const opts=invocation.options as DocxOperationArguments<'charts.list'>;
 const budget=settings.budget.lower(Object.fromEntries((opts.limit??[]).map(limit=>[limit.name,limit.value])));
 if(!(input instanceof Uint8Array))throw new InputTypeError('Expected archive bytes.');budget.check('compressedInput',input.length);budget.charge('retainedBytes',input.length);budget.charge('work',input.length);const owned=new Uint8Array(input);
 const archive=await readDocumentArchive(owned,{...settings,budget}),graph=archive.package;
 const descriptors=new Map<string,ChartPart>(),roots=new Map<string,XmlElement>(),items:ChartRecord[]=[],warnings:InspectionWarning[]=[];
 const hash=async(bytes:Uint8Array)=>{budget.charge('work',bytes.length);budget.charge('retainedBytes',bytes.length+128);const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));budget.check('work',0);return [...digest].map(b=>b.toString(16).padStart(2,'0')).join('');};
 const sourceSha256=await hash(owned);
 const descriptor=async(part:PackagePart):Promise<ChartPart>=>{const existing=descriptors.get(part.partname);if(existing)return existing;budget.charge('retainedBytes',256+(part.partname.length+part.content_type.length)*2);const record={name:part.partname,contentType:part.content_type,bytes:part.bytes.length,sha256:await hash(part.bytes)};descriptors.set(part.partname,record);return record;};
 const root=(part:PackagePart)=>{let parsed=roots.get(part.partname);if(!parsed){parsed=parseDocumentXml(part.bytes,{},budget).root;roots.set(part.partname,parsed);}return parsed;};
 const reference=(owner:string,edge:PackageRelationship):InspectionReference=>{budget.charge('retainedBytes',128+(owner.length+edge.rId.length+edge.reltype.length+edge.target_ref.length)*2);return{owner,id:edge.rId,type:edge.reltype,target:edge.target_ref,external:edge.is_external};};
 const allEdges:{owner:string;edge:PackageRelationship}[]=[];for(const owner of ['/',...graph.parts.filter(p=>!p.content_type.toLowerCase().endsWith('relationships+xml')).map(p=>p.partname)])for(const edge of graph.relationships(owner)){budget.charge('work',1);budget.charge('retainedBytes',32);allEdges.push({owner,edge});}
 for(const part of chartDefinitionParts(graph,budget)){
  await budget.checkpoint();const definition=await descriptor(part),parsed=root(part),decoded=decodeChartContent(parsed,part.partname,budget);let status=decoded.status;const issues=[...decoded.issues];
  const issue=(code:string,path:readonly number[],message:string):ChartIssue=>{budget.charge('diagnosticBytes',code.length+message.length+part.partname.length+32);budget.charge('retainedBytes',128+(code.length+message.length+part.partname.length)*2+path.length*8);return{code,part:part.partname,path,message};};
  if(part.content_type.toLowerCase()!==standardMime){status='opaque';issues.push(issue('opaque-chart-type',[],'The declared resource type is outside the bounded standard chart profile.'));}
  const outgoing=graph.relationships(part.partname);
  const binding=async(role:ChartBinding['role'],id:string|null,path:readonly number[]):Promise<ChartBinding>=>{
   let state:ChartBinding['status']='internal',edge:PackageRelationship|undefined,target:ChartPart|null=null;const bindingIssues:ChartIssue[]=[];
   if(!id)state='missing-id';else{edge=outgoing.find(e=>e.rId===id);if(!edge)state='missing-relationship';else if(!resourceRoles[role].types.includes(edge.reltype))state='wrong-relationship-type';else if(edge.is_external)state='external';else{const targetPart=edge.target_part;target=await descriptor(targetPart);if(!resourceRoles[role].mimes.includes(targetPart.content_type.toLowerCase()))state='wrong-resource-type';else if(role!=='workbook'){const metadata=root(targetPart);if(metadata.namespace!=='http://schemas.microsoft.com/office/drawing/2012/chartStyle'||metadata.localName!==(role==='style'?'chartStyle':'colorStyle'))state='opaque';}}}
   if(edge&&!edge.is_external&&!target)target=await descriptor(edge.target_part);
   if(state!=='internal')bindingIssues.push(issue('chart-binding-'+state,path,'The stored resource binding is external, unresolved or outside its declared inert resource role.'));
   budget.charge('retainedBytes',160+path.length*8);return{role,relationshipId:id,reference:edge?reference(part.partname,edge):null,status:state,target,issues:bindingIssues};
  };
  const externalData:ChartExternalData[]=[];for(const data of decoded.externalData){externalData.push({...data,binding:await binding('workbook',data.relationshipId,data.path)});}
  const resources:ChartBinding[]=[];for(const edge of outgoing){for(const role of ['workbook','style','color'] as const)if(resourceRoles[role].types.includes(edge.reltype))resources.push(await binding(role,edge.rId,[]));}
  const workbookParts=[...new Set([...externalData.map(d=>d.binding),...resources].filter(b=>b.role==='workbook'&&b.status==='internal'&&b.target).map(b=>b.target!.name))].sort(compare);
  const visited=new Set<string>(),pending=[part],graphParts:ChartPart[]=[];
  while(pending.length){await budget.checkpoint(1);const next=pending.pop()!;if(visited.has(next.partname))continue;visited.add(next.partname);budget.charge('retainedBytes',96);graphParts.push(await descriptor(next));for(const edge of graph.relationships(next.partname)){budget.charge('work',1);if(!edge.is_external&&!visited.has(edge.target_part.partname)){budget.charge('retainedBytes',16);pending.push(edge.target_part);}}}graphParts.sort((a,b)=>compare(a.name,b.name));
  const references:InspectionReference[]=[];for(const record of allEdges){budget.charge('work',1);if(visited.has(record.owner)||!record.edge.is_external&&record.edge.target_part.partname===part.partname)references.push(reference(record.owner,record.edge));}
  references.sort((a,b)=>compare(a.owner,b.owner)||compare(a.id,b.id));
  const value={version:1 as const,sourceSha256,generation:0,part:part.partname,story:part.partname,path:[] as readonly number[],range:null};const location:Location<'part'>={kind:'part',value,token:encodeLocation(value),positions:{}};
  budget.charge('matches',1);budget.charge('retainedBytes',512+location.token.length*2);
  const details:ChartDetails={kind:'charts',definition,root:{namespace:parsed.namespace,localName:parsed.localName},status,chartType:status==='decoded'?decoded.chartType:null,chartTypes:status==='decoded'?decoded.chartTypes:[],plotGroups:status==='decoded'?decoded.plotGroups:[],series:status==='decoded'?decoded.series:[],externalData,workbookParts,resources,graphParts,issues};
  items.push({kind:'charts',location,name:part.partname,properties:[],references,support:status==='decoded'?'read':'preserve',details});
 }
 if(items.some(item=>item.support==='preserve'||item.details.issues.length||item.details.series.some(s=>s.issues.length||s.sources.some(source=>source.issues.length))))warnings.push({code:'partial-chart-inventory',message:'Some chart semantics are opaque, malformed or ambiguous; cached data is stored metadata with unknown freshness.'});
 const data={items,warnings};const size=measurePackageResourceSerialization({version:1,operation:'charts.list',ok:true,data,warnings,errors:[],affected:0,locations:items.map(item=>item.location)},budget);budget.charge('retainedBytes',size);return data;
}
