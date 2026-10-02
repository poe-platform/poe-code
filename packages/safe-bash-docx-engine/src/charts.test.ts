import {expect,it} from 'vitest';
import {Volume} from 'memfs';
import {inspectDocumentCharts} from './charts.js';
import {chartFixture,chartContext,chartSpace,chartMime,sheetMime,series} from '../tests/fixtures/charts.js';
import {replaceDocumentText} from './text-replace.js';
import {readArchive} from './archive.js';
import {DocumentBudget} from './budget.js';
import {inspectDocumentImages} from './images.js';
const r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
it.each([false,true])('inventories physical standard chart parts in dialect %s',async strict=>{
 const input=await chartFixture({strict});const data=await inspectDocumentCharts(input,{},chartContext);expect(data.items).toHaveLength(1);expect(data.items[0]!).toMatchObject({kind:'charts',name:'/word/charts/plot.xml',support:'read',location:{kind:'part'},details:{status:'decoded',chartType:'barChart',chartTypes:['barChart']}});expect(data.items[0]!.details.series[0]!.cachedValues).toEqual(['1.00']);
});
it('keeps identical unreferenced definitions distinct and excludes style/color-only resources',async()=>{
 const input=await chartFixture({definitions:[{name:'other/z.xml',xml:chartSpace(),referenced:false},{name:'other/a.xml',xml:chartSpace(),referenced:false}],resources:[{name:'word/charts/style.xml',type:'application/vnd.ms-office.chartstyle+xml',bytes:'<x:chartStyle xmlns:x="urn:original"/>'},{name:'word/charts/colors.xml',type:'application/vnd.ms-office.chartcolorstyle+xml',bytes:'<x:colorStyle xmlns:x="urn:original"/>'}]});
 const data=await inspectDocumentCharts(input,{},chartContext);expect(data.items.map(i=>i.name)).toEqual(['/other/a.xml','/other/z.xml']);expect(data.items[0]!.details.definition.sha256).toBe(data.items[1]!.details.definition.sha256);
});
it('classifies opaque profiles without fabricating an empty decoded chart',async()=>{
 for(const def of [{xml:'<x:chartSpace xmlns:x="urn:foreign"/>',type:chartMime},{xml:'<x:chartSpace xmlns:x="urn:foreign"/>',type:'application/vnd.ms-office.chartex+xml'},{xml:chartSpace('<c:layout/>'),type:chartMime}]){const data=await inspectDocumentCharts(await chartFixture({definitions:[{name:'word/charts/plot.xml',...def}]}),{},chartContext);expect(data.items[0]!.support).toBe('preserve');expect(data.items[0]!.details.status).toBe('opaque');expect(data.items[0]!.details.issues.length).toBeGreaterThan(0);}
});
it('resolves same IDs owner-locally and keeps exact inert resources and external references',async()=>{
 const definitions=['one','two'].map(name=>({name:'word/charts/'+name+'.xml',xml:chartSpace('<c:barChart>'+series()+'</c:barChart>',false,'<c:externalData r:id="data"><c:autoUpdate val="1"/><c:autoUpdate val="0"/></c:externalData>')}));
 const resources=['one','two'].map((name,index)=>({name:'word/embeddings/'+name+'.xlsx',type:sheetMime,bytes:new Uint8Array([80,75,3,4,index])}));
 const relationships=definitions.flatMap((d,i)=>[{owner:'/'+d.name,id:'data',type:r+'/package',target:'../embeddings/'+['one','two'][i]+'.xlsx'},{owner:'/'+d.name,id:'external',type:r+'/hyperlink',target:'https://invalid.example/inert',external:true}]);
 const data=await inspectDocumentCharts(await chartFixture({definitions,resources,relationships}),{},chartContext);expect(data.items.map(i=>i.details.workbookParts)).toEqual([['/word/embeddings/one.xlsx'],['/word/embeddings/two.xlsx']]);expect(data.items[0]!.details.externalData[0]!).toMatchObject({autoUpdate:['1','0'],binding:{status:'internal',target:{bytes:5}}});expect(data.items.every(i=>i.references.some(e=>e.external))).toBe(true);
});
it('distinguishes missing, wrong type and external data bindings',async()=>{
 const extra='<c:externalData/><c:externalData r:id="absent"/><c:externalData r:id="wrong"/><c:externalData r:id="remote"/>';
 const input=await chartFixture({definitions:[{name:'word/charts/plot.xml',xml:chartSpace('<c:barChart/>',false,extra)}],resources:[{name:'word/data.bin',type:'application/octet-stream',bytes:new Uint8Array([1])}],relationships:[{owner:'/word/charts/plot.xml',id:'wrong',type:r+'/hyperlink',target:'../data.bin'},{owner:'/word/charts/plot.xml',id:'remote',type:r+'/package',target:'https://invalid.example/data',external:true}]});
 const data=await inspectDocumentCharts(input,{},chartContext);expect(data.items[0]!.details.externalData.map(e=>e.binding.status)).toEqual(['missing-id','missing-relationship','wrong-relationship-type','external']);
});
it('preserves chart resources, relationships and inactive bytes through unrelated public text edit',async()=>{
 const inactive='<mc:Choice Requires="x" xmlns:x="urn:foreign"><c:lineChart>'+series('Inactive')+'</c:lineChart></mc:Choice>';
 const xml=chartSpace('<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'+inactive+'<mc:Fallback><c:barChart>'+series()+'</c:barChart></mc:Fallback></mc:AlternateContent>');
 const input=await chartFixture({definitions:[{name:'word/charts/plot.xml',xml}],resources:[{name:'word/embeddings/data.xlsx',type:sheetMime,bytes:new Uint8Array([80,75,3,4,0])}],relationships:[{owner:'/word/charts/plot.xml',id:'data',type:r+'/package',target:'../embeddings/data.xlsx'}]});
 const volume=Volume.fromJSON({'/out':''});await replaceDocumentText(input,{find:'coast',with:'shore',first:true,scope:'body',output:'-'},{...chartContext,encoding:{order:'input',compression:'store'},stdout:{async write(bytes){volume.appendFileSync('/out',bytes);}}});
 const before=await readArchive(input,chartContext),output=new Uint8Array(volume.readFileSync('/out') as Buffer),after=await readArchive(output,chartContext);expect(after.members.map(m=>m.name)).toEqual(before.members.map(m=>m.name));for(const member of before.members.filter(m=>m.name!=='word/document.xml'))expect(after.members.find(m=>m.name===member.name)!.bytes).toEqual(member.bytes);
 expect(new TextDecoder().decode(after.members.find(m=>m.name==='word/charts/plot.xml')!.bytes)).toContain(inactive);expect((await inspectDocumentCharts(output,{},chartContext)).items[0]!.details.series[0]!.name).toBe('Coast');
});
it('keeps chart graphics out of picture inventory while exposing utility chart classification',async()=>{
 const input=await chartFixture();expect((await inspectDocumentImages(input,{operation:'images.list'},chartContext)).items).toEqual([]);expect((await inspectDocumentCharts(input,{},chartContext)).items[0]!.kind).toBe('charts');
});
it('snapshots invocation inputs and enforces output and cancellation budgets',async()=>{
 const input=await chartFixture(),options={limit:[{name:'serializedOutput' as const,value:100}]};const pending=inspectDocumentCharts(input,options,chartContext);options.limit[0]!.value=100000;await expect(pending).rejects.toMatchObject({code:'limit-exceeded'});
 const signal=AbortSignal.abort();await expect(inspectDocumentCharts(input,{}, {...chartContext,signal})).rejects.toMatchObject({code:'cancelled'});
 const owned=await chartFixture();const reading=inspectDocumentCharts(owned,{}, {...chartContext,budget:new DocumentBudget()});owned.fill(0);expect((await reading).items).toHaveLength(1);
});
it('retains sorted incoming and transitive closure edges through original cycles',async()=>{
 const input=await chartFixture({resources:[{name:'word/embeddings/data.xlsx',type:sheetMime,bytes:new Uint8Array([80,75,3,4,0])},{name:'word/metadata.xml',type:'application/xml',bytes:'<m:metadata xmlns:m="urn:original"/>'}],relationships:[{owner:'/word/charts/plot.xml',id:'z',type:r+'/package',target:'../embeddings/data.xlsx'},{owner:'/word/charts/plot.xml',id:'a',type:r+'/customXml',target:'../metadata.xml'},{owner:'/word/embeddings/data.xlsx',id:'z',type:r+'/hyperlink',target:'../charts/plot.xml'},{owner:'/word/embeddings/data.xlsx',id:'x',type:r+'/hyperlink',target:'https://invalid.example/workbook',external:true},{owner:'/word/metadata.xml',id:'m',type:r+'/hyperlink',target:'https://invalid.example/metadata',external:true}]});
 const item=(await inspectDocumentCharts(input,{},chartContext)).items[0]!;
 expect(item.details.graphParts.map(p=>p.name)).toEqual(['/word/charts/plot.xml','/word/embeddings/data.xlsx','/word/metadata.xml']);
 expect(item.references.map(e=>e.owner+'#'+e.id)).toEqual(['/word/charts/plot.xml#a','/word/charts/plot.xml#z','/word/document.xml#plot0','/word/embeddings/data.xlsx#x','/word/embeddings/data.xlsx#z','/word/metadata.xml#m']);
});
it.each(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.spreadsheetml.template','application/vnd.ms-excel.sheet.macroEnabled.12','application/vnd.ms-excel.template.macroEnabled.12','application/vnd.ms-excel.sheet.binary.macroEnabled.12'])('uses declared inert workbook MIME rather than suffix %s',async type=>{
 const data=await inspectDocumentCharts(await chartFixture({resources:[{name:'word/opaque.bin',type,bytes:new Uint8Array([0,1,2])}],relationships:[{owner:'/word/charts/plot.xml',id:'workbook',type:r+'/package',target:'../opaque.bin'}]}),{},chartContext);
 expect(data.items[0]!.details.resources[0]!).toMatchObject({status:'internal',target:{contentType:type,bytes:3}});expect(data.items[0]!.details.workbookParts).toEqual(['/word/opaque.bin']);
});
it('separates style color and opaque or external resource role bindings',async()=>{
 const namespace='http://schemas.microsoft.com/office/drawing/2012/chartStyle';
 const input=await chartFixture({resources:[{name:'word/charts/style.xml',type:'application/vnd.ms-office.chartstyle+xml',bytes:'<s:chartStyle xmlns:s="'+namespace+'"/>'},{name:'word/charts/color.xml',type:'application/vnd.ms-office.chartcolorstyle+xml',bytes:'<s:colorStyle xmlns:s="'+namespace+'"/>'},{name:'word/charts/opaque.xml',type:'application/vnd.ms-office.chartstyle+xml',bytes:'<s:chartStyle xmlns:s="urn:foreign"/>'},{name:'word/data.xlsx',type:'application/octet-stream',bytes:new Uint8Array([0])}],relationships:[{owner:'/word/charts/plot.xml',id:'style',type:'http://schemas.microsoft.com/office/2011/relationships/chartStyle',target:'style.xml'},{owner:'/word/charts/plot.xml',id:'color',type:'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle',target:'color.xml'},{owner:'/word/charts/plot.xml',id:'opaque',type:'http://schemas.microsoft.com/office/2011/relationships/chartStyle',target:'opaque.xml'},{owner:'/word/charts/plot.xml',id:'external',type:'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle',target:'https://invalid.example/colors',external:true},{owner:'/word/charts/plot.xml',id:'wrong',type:r+'/package',target:'../data.xlsx'}]});
 const item=(await inspectDocumentCharts(input,{},chartContext)).items[0]!;expect(item.details.resources.map(b=>[b.role,b.status])).toEqual([['style','internal'],['color','internal'],['style','opaque'],['color','external'],['workbook','wrong-resource-type']]);expect(item.details.workbookParts).toEqual([]);
});
it('preserves chart graph bytes and member order through unrelated public property assignment',async()=>{
 const core='<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></cp:coreProperties>';
 const input=await chartFixture({resources:[{name:'docProps/core.xml',type:'application/vnd.openxmlformats-package.core-properties+xml',bytes:core},{name:'word/data.bin',type:sheetMime,bytes:new Uint8Array([80,75,3,4,0])}],relationships:[{owner:'/',id:'core',type:'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',target:'docProps/core.xml'},{owner:'/word/charts/plot.xml',id:'data',type:r+'/package',target:'../data.bin'}]});
 const {editDocumentProperties}=await import('./document-properties.js'),volume=Volume.fromJSON({'/out':''});
 await editDocumentProperties(input,{operation:'properties.set',name:'title',value:'New',output:'-'},{...chartContext,encoding:{order:'input',compression:'store'},stdout:{async write(bytes){volume.appendFileSync('/out',bytes);}}});
 const before=await readArchive(input,chartContext),after=await readArchive(new Uint8Array(volume.readFileSync('/out') as Buffer),chartContext);expect(after.members.map(m=>m.name)).toEqual(before.members.map(m=>m.name));for(const part of before.members.filter(m=>m.name!=='docProps/core.xml'))expect(after.members.find(m=>m.name===part.name)!.bytes).toEqual(part.bytes);
 expect(new TextDecoder().decode(after.members.find(m=>m.name==='docProps/core.xml')!.bytes)).toContain('New');
});

it.each(['tx','val'])('public chart inspection preserves duplicate empty %s evidence',async role=>{
 const xml=chartSpace('<c:barChart>'+series().replace('</c:'+role+'>','</c:'+role+'><c:'+role+'/>')+'</c:barChart>');
 const item=(await inspectDocumentCharts(await chartFixture({definitions:[{name:'word/charts/plot.xml',xml}]}),{},chartContext)).items[0]!;
 const s=item.details.series[0]!;expect(s.sources.some(source=>source.localName===role&&source.kind==='opaque')).toBe(true);
 if(role==='tx'){expect(s.name).toBe(null);expect(s.label.provenance).toBe('ambiguous');}else{expect(s.cachedValues).toEqual([]);expect(s.issues.some(i=>i.code==='ambiguous-primary-cache')).toBe(true);}
});
it('public chart inspection diagnoses missing auto-update scalar with an internal inert workbook',async()=>{
 const xml=chartSpace('<c:barChart>'+series()+'</c:barChart>',false,'<c:externalData r:id="data"><c:autoUpdate/></c:externalData>');
 const input=await chartFixture({definitions:[{name:'word/charts/plot.xml',xml}],resources:[{name:'word/embeddings/data.bin',type:sheetMime,bytes:new Uint8Array([0,1,2])}],relationships:[{owner:'/word/charts/plot.xml',id:'data',type:r+'/package',target:'../embeddings/data.bin'}]});
 const item=(await inspectDocumentCharts(input,{},chartContext)).items[0]!;expect(item.details.externalData[0]!).toMatchObject({autoUpdate:[null],binding:{status:'internal'}});expect(item.details.issues.some(i=>i.code==='opaque-value'&&i.path.length>0)).toBe(true);
});
