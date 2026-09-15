import { Volume } from 'memfs';
import { writeArchive } from '../../src/archive-write.js';
import type { ArchiveContext } from '../../src/archive.js';
import { xmlValue } from '../../src/create-content.js';
import { textContext } from './text.js';
export const chartNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
export const strictChartNamespace = 'http://purl.oclc.org/ooxml/drawingml/chart';
export const chartMime = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
export const sheetMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const chartContext:ArchiveContext = {...textContext,limits:{...textContext.limits,maxMembers:64}};
export function chartSpace(groups='<c:barChart/>',strict=false,extra=''):string {
 const c=strict?strictChartNamespace:chartNamespace;
 const r=strict?'http://purl.oclc.org/ooxml/officeDocument/relationships':'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 return `<c:chartSpace xmlns:c="${c}" xmlns:r="${r}"><c:chart><c:plotArea>${groups}</c:plotArea></c:chart>${extra}</c:chartSpace>`;
}
export function series(label='Coast',value='1.00'):string {
 return `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xmlValue(label)}</c:v></c:tx><c:val><c:numRef><c:f>Sheet1!B2</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xmlValue(value)}</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>`;
}
export interface FixtureDefinition {name:string;xml:string;type?:string;referenced?:boolean}
export interface FixtureResource {name:string;bytes:Uint8Array|string;type:string}
export interface FixtureRelationship {owner:string;id:string;type:string;target:string;external?:boolean}
export interface ChartFixtureOptions {strict?:boolean;definitions?:readonly FixtureDefinition[];resources?:readonly FixtureResource[];relationships?:readonly FixtureRelationship[];body?:string}
export async function chartFixture(options:ChartFixtureOptions={}):Promise<Uint8Array> {
 const strict=options.strict??false;
 const w=strict?'http://purl.oclc.org/ooxml/wordprocessingml/main':'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const r=strict?'http://purl.oclc.org/ooxml/officeDocument/relationships':'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const a=strict?'http://purl.oclc.org/ooxml/drawingml/main':'http://schemas.openxmlformats.org/drawingml/2006/main';
 const wp=strict?'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
 const c=strict?strictChartNamespace:chartNamespace;
 const definitions=options.definitions??[{name:'word/charts/plot.xml',xml:chartSpace('<c:barChart>'+series()+'</c:barChart>',strict)}];
 const resources=options.resources??[];
 const edges:FixtureRelationship[]=[{owner:'/',id:'main',type:r+'/officeDocument',target:'word/document.xml'},...definitions.filter(d=>d.referenced!==false).map((d,i)=>({owner:'/word/document.xml',id:'plot'+i,type:r+'/chart',target:'/'+d.name})),...(options.relationships??[])];
 const files=new Map<string,Uint8Array|string>();
 const overrides=[{name:'word/document.xml',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'},...definitions.map(d=>({name:d.name,type:d.type??chartMime})),...resources];
 files.set('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+overrides.map(d=>`<Override PartName="/${xmlValue(d.name)}" ContentType="${xmlValue(d.type)}"/>`).join('')+'</Types>');
 const drawing=definitions.some(d=>d.referenced!==false)?`<w:r><w:drawing><wp:inline><wp:extent cx="200" cy="300"/><wp:docPr id="1" name="Coast plot"/><a:graphic><a:graphicData uri="${c}"><c:chart r:id="plot0"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`:'';
 files.set('word/document.xml',`<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:c="${c}" xmlns:a="${a}" xmlns:wp="${wp}"><w:body>${options.body??'<w:p><w:r><w:t>coast</w:t></w:r>'+drawing+'</w:p>'}</w:body></w:document>`);
 for(const d of definitions)files.set(d.name,d.xml);
 for(const resource of resources)files.set(resource.name,resource.bytes);
 for(const owner of new Set(edges.map(e=>e.owner))) {
  const name=owner==='/'?'_rels/.rels':owner.slice(1,owner.lastIndexOf('/')+1)+'_rels/'+owner.slice(owner.lastIndexOf('/')+1)+'.rels';
  files.set(name,'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+edges.filter(e=>e.owner===owner).map(e=>`<Relationship Id="${xmlValue(e.id)}" Type="${xmlValue(e.type)}" Target="${xmlValue(e.target)}"${e.external?' TargetMode="External"':''}/>`).join('')+'</Relationships>');
 }
 const volume=Volume.fromJSON({'/archive':''});
 await writeArchive({comment:new Uint8Array(),members:[...files].map(([name,data])=>({name,bytes:typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data),directory:false,modified:new Date('2025-01-02T03:04:06Z')}))},{async write(bytes){volume.appendFileSync('/archive',bytes);}},{order:'input',compression:'store'},chartContext);
 return new Uint8Array(volume.readFileSync('/archive') as Buffer);
}
