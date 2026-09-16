import {DocumentBudget} from './budget.js';
import {documentDialects,type DocumentDialect} from './dialect.js';
import {MarkupCompatibility,documentCompatibilityProfile,type CompatibilityContent} from './compatibility.js';
import type {XmlElement} from './package-xml.js';
import type {DiagramIssue,DiagramRole} from './diagrams.js';
export interface DiagramBindingRequest {readonly role:DiagramRole;readonly attribute:string;readonly relationshipId:string|null}
export interface RawDiagramObservation {readonly kind:'relIds'|'unknown-graphic'|'extension';readonly part:string;readonly path:readonly number[];readonly namespace:string;readonly localName:string;readonly uri:string|null;readonly active:boolean;readonly requests:readonly DiagramBindingRequest[];readonly issues:readonly DiagramIssue[]}
const drawing='http://schemas.microsoft.com/office/drawing/2008/diagram',mc='http://schemas.openxmlformats.org/markup-compatibility/2006';
const officeShape='http://schemas.microsoft.com/office/word/2010/wordprocessingShape',officeGroup='http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
const roots=['dataModel','layoutDef','styleDef','colorsDef'];
/** Observes original physical graphics ancestry without expanding compatibility understanding. */
export function collectDiagramObservations(root:XmlElement,dialect:DocumentDialect,part:string,budget:DocumentBudget):readonly RawDiagramObservation[] {
 const ns=documentDialects[dialect],active=new Set<XmlElement>(),result:RawDiagramObservation[]=[];
 const expose=(content:readonly CompatibilityContent[])=>{for(const item of content){budget.charge('work',1);if('source' in item){active.add(item.source);budget.charge('retainedBytes',16);if(item.disposition==='understood')expose(item.content);}}};expose(new MarkupCompatibility(root,documentCompatibilityProfile,budget).content);
 const attr=(node:XmlElement,name:string,namespace='')=>node.attributes.find(a=>a.namespace===namespace&&a.localName===name)?.value??null;
 const is=(node:XmlElement|undefined,namespace:string,name:string)=>node?.namespace===namespace&&node.localName===name;
 const envelope=(chain:readonly XmlElement[])=>chain.length===4&&is(chain[0],ns.w,'drawing')&&chain[1]?.namespace===ns.wp&&['inline','anchor'].includes(chain[1].localName)&&is(chain[2],ns.a,'graphic')&&is(chain[3],ns.a,'graphicData');
 const add=(node:XmlElement,path:readonly number[],kind:RawDiagramObservation['kind'],uri:string|null,requests:readonly DiagramBindingRequest[]=[])=>{budget.charge('matches',1);budget.charge('retainedBytes',256+path.length*8+(part.length+node.namespace.length+node.localName.length+(uri?.length??0))*2+requests.reduce((n,r)=>n+96+r.attribute.length*2+(r.relationshipId?.length??0)*2,0));const issues:DiagramIssue[]=kind==='relIds'||requests.length?[]:[{code:'opaque-graphics',part,path,message:'Stored graphics content is outside the supported native profile.'}];if(issues.length)budget.charge('diagnosticBytes',issues[0]!.message.length+part.length+64);result.push({kind,part,path,namespace:node.namespace,localName:node.localName,uri,active:active.has(node),requests,issues});};
 const transparentChildren=(node:XmlElement):XmlElement[]=>{const result:XmlElement[]=[];for(const child of node.children){budget.charge('work',1);if(child.namespace===mc&&['AlternateContent','Choice','Fallback'].includes(child.localName))result.push(...transparentChildren(child));else result.push(child);}return result;};
 const visit=(node:XmlElement,path:readonly number[],ancestors:readonly XmlElement[])=>{
  budget.charge('work',ancestors.length+1);budget.charge('retainedBytes',32+path.length*8);
  const chain=ancestors.filter(n=>!(n.namespace===mc&&['AlternateContent','Choice','Fallback'].includes(n.localName)));
  let drawingIndex=-1;chain.forEach((n,i)=>{if(is(n,ns.w,'drawing'))drawingIndex=i;});
  const graphics=drawingIndex>=0?chain.slice(drawingIndex):[];
  if(is(node,ns.a,'graphicData')&&envelope([...graphics,node])){
   const uri=attr(node,'uri'),nativeDiagram=uri===ns.dgm&&transparentChildren(node).some(n=>is(n,ns.dgm,'relIds'));
   const known=uri===ns.pic&&transparentChildren(node).some(n=>is(n,ns.pic,'pic'))||uri===ns.c&&transparentChildren(node).some(n=>is(n,ns.c,'chart'))||transparentChildren(node).some(n=>n.namespace===ns.wp&&['wsp','wgp','grpSp','wpc'].includes(n.localName)||is(n,officeShape,'wsp')||n.namespace===officeGroup&&['wgp','grpSp'].includes(n.localName));
   if(!nativeDiagram&&!known)add(node,path,'unknown-graphic',uri);
  }
  if(is(node,ns.dgm,'relIds')&&envelope(graphics)&&attr(graphics[3]!,'uri')===ns.dgm){const fields=['dm','lo','qs','cs'] as const,roles=['data','layout','style','color'] as const;add(node,path,'relIds',attr(graphics[3]!,'uri'),fields.map((field,i)=>({role:roles[i]!,attribute:field,relationshipId:attr(node,field,ns.r)})));}
  if(is(node,ns.a,'ext')){
   const list=chain.at(-1),parentChain=chain.slice(0,-1),nativeDiagram=is(list,ns.dgm,'extLst')&&parentChain.length===1&&parentChain[0]===root&&root.namespace===ns.dgm&&roots.includes(root.localName);
   let start=-1;parentChain.forEach((n,i)=>{if(is(n,ns.w,'drawing'))start=i;});const nativePath=start>=0?parentChain.slice(start):[];
   const docPr=nativePath.length===3&&is(nativePath[0],ns.w,'drawing')&&nativePath[1]?.namespace===ns.wp&&['inline','anchor'].includes(nativePath[1].localName)&&is(nativePath[2],ns.wp,'docPr');
   const dataIndex=nativePath.findIndex(n=>is(n,ns.a,'graphicData'));
   const belowData=dataIndex===3&&envelope(nativePath.slice(0,4))&&nativePath.slice(4).every(n=>[ns.a,ns.pic,officeShape,officeGroup].includes(n.namespace));
   const nativeDrawing=is(list,ns.a,'extLst')&&(docPr||belowData);
   if(nativeDiagram||nativeDrawing){const uri=attr(node,'uri');if(!node.children.length)add(node,path,'extension',uri);node.children.forEach((child,i)=>{
    if(nativeDrawing&&belowData&&is(parentChain.at(-1),ns.a,'blip')&&uri==='{96DAC541-7B7A-43D3-8B79-37D633B846F1}'&&child.namespace==='http://schemas.microsoft.com/office/drawing/2016/SVG/main'&&child.localName==='svgBlip'||nativeDrawing&&docPr&&uri==='{C183D7F6-B498-43B3-948B-1728B52AA6E4}'&&child.namespace==='http://schemas.microsoft.com/office/drawing/2017/decorative'&&child.localName==='decorative')return;
    const requests=nativeDiagram&&uri===drawing&&is(child,drawing,'dataModelExt')?[{role:'drawing' as const,attribute:'relId',relationshipId:attr(child,'relId')}]:[];
    add(child,[...path,i],'extension',uri,requests);
   });}
  }
  node.children.forEach((child,i)=>visit(child,[...path,i],[...ancestors,node]));
 };visit(root,[],[]);return result.sort((a,b)=>{for(let i=0;i<Math.min(a.path.length,b.path.length);i++){const n=a.path[i]!-b.path[i]!;if(n)return n;}return a.path.length-b.path.length;});
}
