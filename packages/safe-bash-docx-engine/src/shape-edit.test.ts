import { expect, it } from 'vitest';
import { Volume } from 'memfs';
import { inspectDocumentShapes, editDocumentShapes } from './shape-edit.js';
import { box } from '../tests/fixtures/shapes.js';
import { textFixture, textContext } from '../tests/fixtures/text.js';
import { openDocumentLocations } from './locations.js';
it.each(['office','vml','native'] as const)('assigns %s box text preserving properties and geometry', async kind => {
 const source = box('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>coast</w:t></w:r></w:p>',kind);
 const input = await textFixture(source);
 const listing = await inspectDocumentShapes(input, {}, textContext);
 expect(listing.items).toHaveLength(1);
 const volume = Volume.fromJSON({'/out':''});
 const result = await editDocumentShapes(input,{operation:'shapes.set',options:{shape:1,text:'shore',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout:{async write(bytes) {volume.appendFileSync('/out',bytes);}}});
 expect(result.changed).toBe(true);
 const output = new Uint8Array(volume.readFileSync('/out') as Buffer);
 const document = await openDocumentLocations(output,textContext);
 expect(document.text({scope:'text-boxes'}).text).toBe('shore');
 const xml = new TextDecoder().decode(document.snapshot().members.find(m => m.name === 'word/document.xml')!.bytes);
 expect(xml).toContain('<w:pPr><w:bidi/></w:pPr>');
 expect(xml).not.toContain('<w:b/>');
 if(kind==='vml')expect(xml).toContain('height:20pt');
 else expect(xml).toContain('<s:spPr/>');
});

it.each([
 '<w:p><w:hyperlink w:anchor="local"><w:r><w:t>coast</w:t></w:r></w:hyperlink></w:p>',
 '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>coast</w:t></w:r></w:fldSimple></w:p>',
 '<w:p/><w:p/>',
 '<w:p><w:pPr><w:b/></w:pPr><w:r><w:t>coast</w:t></w:r></w:p>',
 '<w:p><w:pPr>discarded</w:pPr><w:r><w:t>coast</w:t></w:r></w:p>'
])('rich or misplaced content never advertises plain assignment support %s', async content => {
 const input=await textFixture(box(content));
 const listing=await inspectDocumentShapes(input,{},textContext);
 expect(listing.items[0]!.details.editSupport).toBe('unsupported');
 await expect(editDocumentShapes(input,{operation:'shapes.set',options:{shape:1,text:'shore',dryRun:true}},{...textContext,encoding:{order:'input',compression:'store'}})).rejects.toMatchObject({code:'unsupported-edit'});
});

it('records non-rendered header and text-path watermark evidence', async () => {
 const header='<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="heading-art"><v:textpath string="Coast"/></v:shape></w:pict></w:r></w:p></w:hdr>';
 const input=await textFixture('<w:sectPr><w:headerReference w:type="default" r:id="extra"/></w:sectPr>',{extra:{kind:'header',xml:header}});
 const listing=await inspectDocumentShapes(input,{scope:'headers'},textContext);
 expect(listing.items[0]!.details.watermarkEvidence).toEqual(['header-story','text-path-declaration']);
 expect(listing.items[0]!.details.sectionReferences).toHaveLength(1);
});
it('snapshots invocation flags before asynchronous admission',async()=>{
 const input=await textFixture(box());
 const volume=Volume.fromJSON({'/out':''});
 const options={shape:1,text:'shore',dryRun:true,output:'-'};
 const pending=editDocumentShapes(input,{operation:'shapes.set',options},{...textContext,encoding:{order:'input',compression:'store'},stdout:{async write(bytes){volume.appendFileSync('/out',bytes);}}});
 options.dryRun=false;options.text='changed after call';
 const result=await pending;
 expect(result.dryRun).toBe(true);
 expect(volume.readFileSync('/out').length).toBe(0);
});

it.each(['group','canvas','multiple','opaque','linked','nested'] as const)('refuses %s shape assignments before output',async reason=>{
 let source=box();
 const wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
 if(reason==='group')source=source.replace('<s:wsp','<g:wgp xmlns:g="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><s:wsp').replace('</s:wsp>','</s:wsp></g:wgp>');
 if(reason==='canvas')source=source.replace('<s:wsp','<c:wpc xmlns:c="'+wp+'"><s:wsp').replace('</s:wsp>','</s:wsp></c:wpc>');
 if(reason==='multiple')source=source.replace('</s:txbx>','<w:txbxContent><w:p/></w:txbxContent></s:txbx>');
 if(reason==='opaque')source=source.replace('<w:txbxContent>','<e:txbxContent xmlns:e="http://schemas.microsoft.com/office/word/2006/wordml">').replace('</w:txbxContent>','</e:txbxContent>');
 if(reason==='linked')source=source.replace('<s:txbx>','<s:txbx id="7">')+box().replace('<s:txbx><w:txbxContent><w:p><w:r><w:t>coast</w:t></w:r></w:p></w:txbxContent></s:txbx>','<s:linkedTxbx id="7" seq="1"/>');
 if(reason==='nested')source=box('<w:p><w:r><w:t>coast</w:t></w:r></w:p>'+box());
 const input=await textFixture(source),volume=Volume.fromJSON({'/out':''});
 await expect(editDocumentShapes(input,{operation:'shapes.set',options:{all:true,text:'shore',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout:{async write(bytes){volume.appendFileSync('/out',bytes);}}})).rejects.toMatchObject({code:'unsupported-edit'});
 expect(volume.readFileSync('/out').length).toBe(0);
});
it('shared header inventory records edit ambiguity while setter rejects it',async()=>{
 const header='<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+box()+'</w:hdr>';
 const section='<w:sectPr><w:headerReference w:type="default" r:id="extra"/></w:sectPr>';
 const input=await textFixture('<w:p><w:pPr>'+section+'</w:pPr></w:p>'+section,{extra:{kind:'header',xml:header}});
 const listing=await inspectDocumentShapes(input,{scope:'headers'},textContext);
 expect(listing.items[0]!.support).toBe('preserve');
 expect(listing.items[0]!.details.editSupport).toBe('unsupported');
 expect(listing.items[0]!.details.refusalReasons).toContain('shared-owner');
 await expect(editDocumentShapes(input,{operation:'shapes.set',options:{scope:'headers',shape:1,text:'shore',dryRun:true}},{...textContext,encoding:{order:'input',compression:'store'}})).rejects.toMatchObject({code:'ambiguous-selection'});
});
it.each(['-','/out'])('mixed supported and grouped all selection refuses before publication %s',async output=>{
 const {groupedNativeBox}=await import('../tests/fixtures/shapes.js');
 const input=await textFixture(box()+groupedNativeBox()),volume=Volume.fromJSON({'/out':'original','/stdout':''});
 let io=0;
 const filesystem={capabilitiesFor:async()=>{io++;throw new Error('Unexpected publication I/O');}} as unknown as import('@poe-code/safe-fs/core').FileSystem;
 await expect(editDocumentShapes(input,{operation:'shapes.set',options:{all:true,text:'shore',output,...(output==='-'?{}:{force:true})}},{...textContext,filesystem,encoding:{order:'input',compression:'store'},stdout:{async write(bytes){volume.appendFileSync('/stdout',bytes);}}})).rejects.toMatchObject({code:'unsupported-edit'});
 expect(io).toBe(0);expect(volume.readFileSync('/out','utf8')).toBe('original');expect(volume.readFileSync('/stdout').length).toBe(0);
});
it('preserves inactive duplicate fallback choice bytes after active setter',async()=>{
 const inactive='<mc:Choice Requires="s" xmlns:s="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'+box()+'</mc:Choice>';
 const source='<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:r><mc:AlternateContent>'+inactive+'<mc:Fallback>'+box(undefined,'vml')+'</mc:Fallback></mc:AlternateContent></w:r></w:p>';
 const input=await textFixture(source),volume=Volume.fromJSON({'/out':''});
 const listing=await inspectDocumentShapes(input,{},textContext);expect(listing.items).toHaveLength(1);
 await editDocumentShapes(input,{operation:'shapes.set',options:{shape:1,text:'shore',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout:{async write(bytes){volume.appendFileSync('/out',bytes);}}});
 const document=await openDocumentLocations(new Uint8Array(volume.readFileSync('/out') as Buffer),textContext);
 expect(document.text({scope:'text-boxes'}).text).toBe('shore');
 const xml=new TextDecoder().decode(document.snapshot().members.find(m=>m.name==='word/document.xml')!.bytes);
 expect(xml).toContain(inactive);
});

it('assigns a native Strict box through the public SDK preserving inactive bytes and geometry',async()=>{
 const geometry='<s:spPr><a:xfrm xmlns:a="http://purl.oclc.org/ooxml/drawingml/main"><a:off x="123" y="456"/><a:ext cx="200" cy="300"/></a:xfrm></s:spPr>';
 const active=box('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>coast</w:t></w:r></w:p>','native',true).replace('<s:spPr/>',geometry);
 const inactive='<mc:Choice Requires="s" xmlns:s="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'+box()+'</mc:Choice>';
 const source='<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:r><mc:AlternateContent>'+inactive+'<mc:Fallback>'+active+'</mc:Fallback></mc:AlternateContent></w:r></w:p>';
 const input=await textFixture(source,{},true),volume=Volume.fromJSON({'/out':''});
 const {inspectDocumentShapes:inspect,editDocumentShapes:set}=await import('./index.js');
 const original=await openDocumentLocations(input,textContext);
 const originalXml=new TextDecoder().decode(original.snapshot().members.find(m=>m.name==='word/document.xml')!.bytes);
 const inactiveStart=originalXml.indexOf('<mc:Choice'),inactiveEnd=originalXml.indexOf('</mc:Choice>')+'</mc:Choice>'.length;
 const inactiveBytes=new TextEncoder().encode(originalXml.slice(inactiveStart,inactiveEnd));
 const listing=await inspect(input,{},textContext);
 expect(listing.items).toHaveLength(1);expect(listing.items[0]!.details.representation).toBe('native');
 const result=await set(input,{operation:'shapes.set',options:{select:listing.items[0]!.location.token,text:'shore',output:'-'}},{...textContext,encoding:{order:'input',compression:'store'},stdout:{async write(bytes){volume.appendFileSync('/out',bytes);}}});
 expect(result.changed).toBe(true);
 const document=await openDocumentLocations(new Uint8Array(volume.readFileSync('/out') as Buffer),textContext);
 expect(document.text({scope:'text-boxes'}).text).toBe('shore');expect(document.text({scope:'body'}).text).toBe('');
 const xml=new TextDecoder().decode(document.snapshot().members.find(m=>m.name==='word/document.xml')!.bytes);
 expect(xml).toContain('<w:pPr><w:bidi/></w:pPr>');expect(xml).toContain(geometry);
 expect(xml).toContain('http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing');
 const start=xml.indexOf('<mc:Choice'),end=xml.indexOf('</mc:Choice>')+'</mc:Choice>'.length;
 expect(new TextEncoder().encode(xml.slice(start,end))).toEqual(inactiveBytes);
 expect(xml.slice(xml.indexOf('<mc:Fallback'))).not.toContain('<w:b/>');
});
