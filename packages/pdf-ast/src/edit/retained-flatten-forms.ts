import {IntegerTable,PagedStorage} from "@poe-code/safe-fs/storage";
import {cosArray,cosBool,cosDict,cosName,cosNumber,decodePdfString,dictGet,dictSet,type PdfCosNode,type PdfCosRef,type PdfCosDict} from "../ast.js";
import {appendStoredRecord,readStoredRecord} from "../content/stored-record.js";
import {PdfNameIndex} from "../cos/name-index.js";
import type {PdfMutableObjectStore} from "../cos/mutable-object-store.js";
import type {PdfIndexStorage} from "../cos/object-index.js";
import type {PdfRetainedDocument} from "../retained-document.js";
import {PdfFileSource} from "../source.js";
import {PdfError} from "../errors.js";

type Location={reference:PdfCosRef;path:(string|number)[]};
type Frame={location:Location;named:boolean;ft:string;depth:number}|{exit:number};

/** PDFtk form flattening preserves encoded appearance streams, local resource
 * namespaces and fallback text bytes. Traversal and baked identities live on
 * caller storage, including direct dictionaries owned by shared indirect arrays. */
export async function flattenRetainedForms(document:PdfRetainedDocument,store:PdfMutableObjectStore,storage:PdfIndexStorage,signal:AbortSignal):Promise<void>{
 if(!document.crossReference.rootRef)return;
 const backing=new PagedStorage({fs:storage.fs,cwd:storage.directory,env:{},signal},4),names=new PdfNameIndex(storage,Infinity,signal),baked=new IntegerTable(backing),active=new IntegerTable(backing),fields=new IntegerTable(backing),pagesSeen=new IntegerTable(backing),walkMarks=new IntegerTable(backing);
 let head=-1,fieldCount=0,work=0,walk=0,failed=false;
 async function checkpoint(depth=0){signal.throwIfAborted();if(depth>document.depthLimit)throw new PdfError("E_LIMIT","PDF form field depth limit exceeded");if(++work%64===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();}}
 const child=(location:Location,key:string|number):Location=>({reference:location.reference,path:[...location.path,key]});
 async function locate(location:Location){
  let owner=await store.get(location.reference.objectNumber);if(!owner||owner.generationNumber!==location.reference.generationNumber||owner.stream)return;
  let value:PdfCosNode|undefined=owner.value,path:(string|number)[]=[],reference=location.reference,refs=0;
  for(let i=0;i<=location.path.length;i++){
   while(value?.kind==="ref"){await checkpoint(++refs);reference=value;owner=await store.get(value.objectNumber);if(!owner||owner.generationNumber!==reference.generationNumber||owner.stream)return;value=owner.value;path=[];}
   if(!value)return;if(i===location.path.length)return {value,owner,location:{reference,path}};
   const key=location.path[i]!;path.push(key);value=typeof key==="number"?value.kind==="array"?value.items[key]:undefined:value.kind==="dict"?dictGet(value,key):undefined;
  }
 }
 async function identity(location:Location){return (await names.intern(`${location.reference.objectNumber}:${location.reference.generationNumber}:${JSON.stringify(location.path)}`)).index;}
 async function resolve(node:PdfCosNode|undefined){const found=await document.lookup(node);return found?.stream?undefined:found?.value;}
 async function number(node:PdfCosNode|undefined,fallback:number){const value=await resolve(node);return value?.kind==="number"?value.value:fallback;}
 async function push(frame:Frame){head=await appendStoredRecord(backing,{frame,previous:head},-1,signal);}
 async function set(location:Location,key:string,value:PdfCosNode){const found=await locate(location);if(found?.value.kind==="dict"){dictSet(found.value,key,value);await store.set(found.owner);}}
 async function stream(dict:PdfCosDict,chunks:Iterable<Uint8Array>){
  const source=await PdfFileSource.fromStream(storage.fs,storage.directory,chunks,{signal});let failed=false;
  try{dictSet(dict,"Length",cosNumber(source.size));const ref=await store.allocate();await store.set({objectNumber:ref.objectNumber,generationNumber:0,value:dict,stream:{length:source.size,chunks:source.stream(0,source.size,signal),decoded:true}});return ref;}
  catch(error){failed=true;throw error;}finally{await source.close().catch(error=>{if(!failed)throw error;});}
 }
 async function append(page:Location,ref:PdfCosRef){
  const found=await locate(page);if(found?.value.kind!=="dict")return;const existing=dictGet(found.value,"Contents");
  if(!existing){dictSet(found.value,"Contents",ref);await store.set(found.owner);return;}
  const contents=await locate(child(page,"Contents"));
  if(contents?.value.kind==="array"){contents.value.items.push(ref);await store.set(contents.owner);}
  else{dictSet(found.value,"Contents",cosArray([existing,ref]));await store.set(found.owner);}
 }
 async function inheritedResources(page:Location){
  const mark=BigInt(++walk);let location:Location|undefined=page;
  while(location){await checkpoint();const found=await locate(location);if(found?.value.kind!=="dict")return;
   const key=BigInt(await identity(found.location));if(await walkMarks.get(key)===mark)return;await walkMarks.set(key,mark);
   const node=dictGet(found.value,"Resources");if(node!==undefined){const value=await resolve(node);return value?.kind==="dict"?value:undefined;}location=child(found.location,"Parent");
  }
 }
 const encoder=new TextEncoder();
 function* textChunks(text:string,x:number,y:number,font:string){
  yield encoder.encode(`\nq BT /${font} 11 Tf `);const normalized=text.replaceAll("\r\n","\n");let offset=0,line=0;
  while(offset<=normalized.length){
   signal.throwIfAborted();const end=normalized.indexOf("\n",offset),part=normalized.slice(offset,end<0?normalized.length:end);
   yield encoder.encode(line++?" 0 -13 Td (":`${Math.round(x)} ${Math.round(y)} Td (`);let escaped="";
   for(const char of part){escaped+=(char==="("||char===")"||char==="\\"?"\\":"")+char;if(escaped.length>=2048){yield encoder.encode(escaped);escaped="";}}
   if(escaped)yield encoder.encode(escaped);yield encoder.encode(") Tj");if(end<0)break;offset=end+1;
  }
  yield encoder.encode(" ET Q\n");
 }
 async function draw(page:Location,text:string,x:number,y:number){
  if(!text)return;
  let resources=await locate(child(page,"Resources"));if(resources?.value.kind!=="dict"){await set(page,"Resources",cosDict({}));resources=await locate(child(page,"Resources"));}
  const resourceLocation=resources!.location;let fonts=await locate(child(resourceLocation,"Font"));
  if(fonts?.value.kind!=="dict"){await set(resourceLocation,"Font",cosDict({}));fonts=await locate(child(resourceLocation,"Font"));}
  const font=fonts!.value as PdfCosDict,key=dictGet(font,"F1")?"F_AcroFlat":"F1";
  if(!dictGet(font,key)){dictSet(font,key,await store.allocate(cosDict({Type:cosName("Font"),Subtype:cosName("Type1"),BaseFont:cosName("Helvetica")})));await store.set(fonts!.owner);}
  await append(page,await stream(cosDict({}),textChunks(text,x,y,key)));
 }
 async function textValue(node:PdfCosNode|undefined,arrays:boolean){
  if(node?.kind==="string")return decodePdfString(node);if(node?.kind==="name"&&node.decoded!=="Off")return node.decoded;if(node?.kind==="boolean"&&node.value)return "Yes";
  if(arrays&&node?.kind==="array"){let text="",count=0;for(const item of node.items){await checkpoint();const value=await resolve(item);if(value?.kind==="string"||value?.kind==="name")text+=(count++?", ":"")+(value.kind==="string"?decodePdfString(value):value.decoded);}return text;}return "";
 }
 const root:Location={reference:document.crossReference.rootRef,path:[]},form=child(root,"AcroForm");
 try{
  const fieldArray=await locate(child(form,"Fields"));
  if(fieldArray?.value.kind==="array")for(let i=fieldArray.value.items.length-1;i>=0;i--){await checkpoint();await push({location:child(fieldArray.location,i),named:false,ft:"",depth:0});}
  while(head!==-1){
   const record=(await readStoredRecord<{frame:Frame;previous:number}>(backing,head,signal)).value;head=record.previous;const frame=record.frame;
   if("exit" in frame){await active.set(BigInt(frame.exit),0n);continue;}await checkpoint(frame.depth);
   const found=await locate(frame.location);if(found?.value.kind!=="dict")continue;const id=await identity(found.location);if(await active.get(BigInt(id)))continue;await active.set(BigInt(id),1n);await push({exit:id});
   const name=await resolve(dictGet(found.value,"T")),type=await resolve(dictGet(found.value,"FT")),named=frame.named||(name?.kind==="string"?!!decodePdfString(name):name?.kind==="name"?!!name.decoded:false),ft=type?.kind==="name"?type.decoded:frame.ft;
   const kids=await locate(child(found.location,"Kids"));let descend=false;
   if(kids?.value.kind==="array"&&kids.value.items.length){
    let namedKids=false;for(let i=0;i<kids.value.items.length;i++){await checkpoint();const kid=await locate(child(kids.location,i));if(kid?.value.kind==="dict"&&dictGet(kid.value,"T")){namedKids=true;break;}}
    descend=namedKids||!ft||!named;
    if(descend)for(let i=kids.value.items.length-1;i>=0;i--){await checkpoint();await push({location:child(kids.location,i),named,ft,depth:frame.depth+1});}
   }
   if(!descend&&named){const at=await appendStoredRecord(backing,found.location,-1,signal);await fields.set(BigInt(fieldCount++),BigInt(at));}
  }
  let firstPage:Location|undefined;
  for await(const page of document.pages()){
   await checkpoint();if(!page.reference)throw new PdfError("E_PARSE","Expected retained form page reference");
   const pageLocation:Location={reference:page.reference,path:[]};if(!firstPage)firstPage=pageLocation;
   if(await pagesSeen.get(BigInt(page.reference.objectNumber)))continue;await pagesSeen.set(BigInt(page.reference.objectNumber),1n);
   const annotations=await locate(child(pageLocation,"Annots"));if(annotations?.value.kind!=="array")continue;const survivors:PdfCosNode[]=[];
   for(let i=0;i<annotations.value.items.length;i++){
    await checkpoint();const annotation=await locate(child(annotations.location,i));
    if(annotation?.value.kind!=="dict"){survivors.push(annotations.value.items[i]!);continue;}
    const subtype=await resolve(dictGet(annotation.value,"Subtype"));
    if(!(subtype?.kind==="name"&&subtype.decoded==="Widget")&&!dictGet(annotation.value,"FT")&&!dictGet(annotation.value,"T")){survivors.push(annotations.value.items[i]!);continue;}
    await baked.set(BigInt(await identity(annotation.location)),1n);const parent=await locate(child(annotation.location,"Parent"));if(parent?.value.kind==="dict")await baked.set(BigInt(await identity(parent.location)),1n);
    const rect=await resolve(dictGet(annotation.value,"Rect")),items=rect?.kind==="array"?rect.items:[];
    const x=await number(items[0],50),y=await number(items[1],700),ownState=await resolve(dictGet(annotation.value,"AS"));
    const value=ownState??await resolve(dictGet(annotation.value,"V")??(parent?.value.kind==="dict"?dictGet(parent.value,"V")??dictGet(parent.value,"AS"):undefined));
    const appearance=await locate(child(annotation.location,"AP"));let normal=appearance?.value.kind==="dict"?await document.lookup(dictGet(appearance.value,"N")):undefined;
    if(normal?.value.kind==="dict"&&!normal.stream&&value?.kind==="name"&&value.decoded!=="Off")normal=await document.lookup(dictGet(normal.value,value.decoded));
    if(normal?.stream&&normal.reference&&normal.value.kind==="dict"){
     const inherited=await inheritedResources(pageLocation),resources:PdfCosDict={kind:"dict",entries:[...(inherited?.entries??[])]};
     const old=await resolve(dictGet(resources,"XObject")),objects:PdfCosDict={kind:"dict",entries:[...(old?.kind==="dict"?old.entries:[])]};let suffix=1;while(dictGet(objects,`AcroAppearance${suffix}`)){await checkpoint();suffix++;}
     const name=`AcroAppearance${suffix}`,dict:PdfCosDict={kind:"dict",entries:[...normal.value.entries]};dictSet(dict,"Type",cosName("XObject"));dictSet(dict,"Subtype",cosName("Form"));
     const original=await store.get(normal.reference.objectNumber),ref=await store.allocate();if(!original?.stream)throw new PdfError("E_PARSE","Missing retained appearance stream");
     await store.set({...original,objectNumber:ref.objectNumber,generationNumber:0,value:dict});dictSet(objects,name,ref);dictSet(resources,"XObject",objects);await set(pageLocation,"Resources",resources);
     const r2=await resolve(items[2]),r3=await resolve(items[3]),width=r2?.kind==="number"?Math.max(1,Math.abs(r2.value-x)):20,height=r3?.kind==="number"?Math.max(1,Math.abs(r3.value-y)):20;
     const bbox=await resolve(dictGet(dict,"BBox"));let bx0=0,by0=0,bx1=width,by1=height;
     if(bbox?.kind==="array"&&bbox.items.length>=4){const b=await Promise.all(bbox.items.slice(0,4).map(resolve));if(b.every(v=>v?.kind==="number")){const n=b as {value:number}[];bx0=Math.min(n[0]!.value,n[2]!.value);by0=Math.min(n[1]!.value,n[3]!.value);bx1=Math.max(n[0]!.value,n[2]!.value);by1=Math.max(n[1]!.value,n[3]!.value);}}
     const matrix=await resolve(dictGet(dict,"Matrix")),values=matrix?.kind==="array"&&matrix.items.length>=6?await Promise.all(matrix.items.slice(0,6).map(v=>number(v,0))):[1,0,0,1,0,0];
     const [ma,mb,mc,md,me,mf]=values as [number,number,number,number,number,number],corners=[[bx0*ma+by0*mc+me,bx0*mb+by0*md+mf],[bx1*ma+by0*mc+me,bx1*mb+by0*md+mf],[bx0*ma+by1*mc+me,bx0*mb+by1*md+mf],[bx1*ma+by1*mc+me,bx1*mb+by1*md+mf]];
     const minX=Math.min(...corners.map(c=>c[0]!)),minY=Math.min(...corners.map(c=>c[1]!)),bw=Math.max(1,Math.max(...corners.map(c=>c[0]!))-minX),bh=Math.max(1,Math.max(...corners.map(c=>c[1]!))-minY);
     const sx=Number((width/bw).toFixed(6)),sy=Number((height/bh).toFixed(6)),tx=Number((x-minX*sx).toFixed(6)),ty=Number((y-minY*sy).toFixed(6));
     await append(pageLocation,await stream(cosDict({}),[encoder.encode(`\nq ${sx} 0 0 ${sy} ${tx} ${ty} cm /${name} Do Q\n`)]));
    }else await draw(pageLocation,await textValue(value,true),x+2,y+4);
   }
   await set(pageLocation,"Annots",cosArray(survivors));
  }
  if(!firstPage)return;
  for(let i=0;i<fieldCount;i++){
   await checkpoint();const location=(await readStoredRecord<Location>(backing,Number(await fields.get(BigInt(i))),signal)).value,field=await locate(location);if(field?.value.kind!=="dict"||await baked.get(BigInt(await identity(field.location))))continue;
   const rect=await resolve(dictGet(field.value,"Rect")),items=rect?.kind==="array"?rect.items:[],x=await number(items[0],50),y=await number(items[1],700),value=await resolve(dictGet(field.value,"V")??dictGet(field.value,"AS"));
   await draw(firstPage,await textValue(value,false),x+2,y+4);
  }
  const latest=await locate(form);if(latest?.value.kind==="dict"){dictSet(latest.value,"Fields",cosArray([]));dictSet(latest.value,"NeedAppearances",cosBool(false));await store.set(latest.owner);}
 }catch(error){failed=true;throw error;}finally{const results=await Promise.allSettled([backing.close(),names.close()]);if(!failed)for(const result of results)if(result.status==="rejected")await Promise.reject(result.reason);}
}
