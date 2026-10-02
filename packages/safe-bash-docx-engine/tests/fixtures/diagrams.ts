import {chartFixture,chartContext,type FixtureResource,type FixtureRelationship} from './charts.js';
export const diagramContext=chartContext;
export const diagramNamespace='http://schemas.openxmlformats.org/drawingml/2006/diagram';
export const drawingNamespace='http://schemas.microsoft.com/office/drawing/2008/diagram';
export const diagramRoles=['data','layout','style','color','drawing'] as const;
export function diagramCarrier(strict=false,uri?:string,ids:readonly string[]=['data','layout','style','color']):string {
 const d=strict?'http://purl.oclc.org/ooxml/drawingml/diagram':diagramNamespace;
 return '<w:r><w:drawing><wp:inline><wp:extent cx="200" cy="300"/><wp:docPr id="1" name="Original graph"/><a:graphic><a:graphicData'+(uri===undefined?' uri="'+d+'"':uri===''?'':' uri="'+uri+'"')+'><d:relIds xmlns:d="'+d+'" '+['dm','lo','qs','cs'].map((a,i)=>'r:'+a+'="'+ids[i]+'"').join(' ')+'/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}
export async function diagramFixture(options:{strict?:boolean;body?:string;resources?:readonly FixtureResource[];relationships?:readonly FixtureRelationship[];orphan?:boolean}={}):Promise<Uint8Array> {
 const strict=options.strict??false,d=strict?'http://purl.oclc.org/ooxml/drawingml/diagram':diagramNamespace,r=strict?'http://purl.oclc.org/ooxml/officeDocument/relationships':'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const resources=options.resources??['data','layout','style','color'].map((role,i)=>({name:'word/graphs/'+role+'.xml',type:'application/vnd.openxmlformats-officedocument.drawingml.'+['diagramData','diagramLayout','diagramStyle','diagramColors'][i]+'+xml',bytes:'<d:'+['dataModel','layoutDef','styleDef','colorsDef'][i]+' xmlns:d="'+d+'"/>'}));
 const relationships=options.relationships??(options.orphan?[]:['data','layout','style','color'].map((role,i)=>({owner:'/word/document.xml',id:role,type:r+'/'+['diagramData','diagramLayout','diagramQuickStyle','diagramColors'][i],target:'graphs/'+role+'.xml'})));
 return chartFixture({strict,definitions:[],resources,relationships,body:options.body??'<w:p><w:r><w:t>coast</w:t></w:r>'+diagramCarrier(strict)+'</w:p>'});
}
