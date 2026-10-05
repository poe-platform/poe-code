import {expect,it} from "vitest";
import {createMemoryFileSystem} from "@poe-code/safe-fs";
import {PdfDocument} from "../document.js";
import {PdfFileSource} from "../source.js";
import {PdfRetainedDocument} from "../retained-document.js";
import {cosArray,cosBool,cosDict,cosName,cosNumber,cosStream,cosString,dictSet} from "../ast.js";
import {flattenDocumentFormFields} from "./forms.js";
import {editRetainedDocument} from "./retained-graph.js";
import {saveRetainedDocumentChunks} from "./retained-save.js";

it.each(["text","multiline","appearance","matrix","state","off","array","boolean","unattached","parent","direct","shared-array","no-pages","no-form","existing-font","indirect-resources","contents-array"])("preserves %s form flattening bytes",async mode=>{
 const doc=PdfDocument.create();if(mode!=="no-pages")doc.addPage([300,300]);
 const field=cosDict({T:cosString("field"),FT:cosName("Tx"),Subtype:cosName("Widget"),Rect:cosArray([20,40,200,80].map(v=>cosNumber(v))),V:mode==="boolean"?cosBool(true):mode==="array"?cosArray([cosString("one"),cosName("two"),cosNumber(9)]):cosString(mode==="multiline"?"one\r\ntwo (é)\\😀\n":"value")});
 if(["appearance","matrix","state","off"].includes(mode)){
  const ap=doc.cos.allocateObject(cosStream(new TextEncoder().encode("q 1 0 0 rg 0 0 50 20 re f Q\n"),{compress:true,dict:cosDict({BBox:cosArray([0,0,50,20].map(v=>cosNumber(v))),...(mode==="matrix"?{Matrix:cosArray([0,1,-1,0,5,8].map(v=>cosNumber(v)))}:{})})}));
  dictSet(field,"AP",cosDict({N:mode==="state"||mode==="off"?cosDict({On:ap,Off:ap}):ap}));if(mode==="state"||mode==="off")dictSet(field,"AS",cosName(mode==="off"?"Off":"On"));
 }
 const entry=mode==="direct"||mode==="shared-array"?field:doc.cos.allocateObject(field);
 const entries=mode==="shared-array"?doc.cos.allocateObject(cosArray([entry])):cosArray([entry]);
 let formFields=entries;
 if(mode==="parent"){
  const parent=doc.cos.allocateObject(cosDict({T:cosString("parent"),FT:cosName("Tx"),V:cosString("parent value"),Kids:cosArray([entry])}));dictSet(field,"Parent",parent);formFields=cosArray([parent]);
 }
 if(mode!=="no-form")dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"AcroForm",cosDict({Fields:formFields}));
 if(mode!=="no-pages"){
  const page=doc.getPage(0);if(mode!=="unattached")dictSet(page.pageDict,"Annots",entries);
  if(mode==="existing-font"||mode==="indirect-resources"){
   const fonts=cosDict({F1:doc.cos.allocateObject(cosDict({Type:cosName("Font"),Subtype:cosName("Type1"),BaseFont:cosName("Courier")}))});
   dictSet(page.pageDict,"Resources",mode==="indirect-resources"?doc.cos.allocateObject(cosDict({Font:doc.cos.allocateObject(fonts)})):cosDict({Font:fonts}));
  }
  if(mode==="contents-array")dictSet(page.pageDict,"Contents",doc.cos.allocateObject(cosArray([doc.cos.allocateObject(cosStream(new TextEncoder().encode("q Q\n"),{compress:false}))])));
 }
 const bytes=doc.save(),expected=PdfDocument.load(bytes);flattenDocumentFormFields(expected.cos);
 const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",bytes);const storage={fs,directory:"/scratch"},source=await PdfFileSource.open(fs,"/input"),document=await PdfRetainedDocument.open(source,storage);
 try{const edited=await editRetainedDocument(document,storage,{flattenForms:true});try{const chunks=[];for await(const chunk of saveRetainedDocumentChunks(edited.document,storage))chunks.push(chunk);expect(new Uint8Array(Buffer.concat(chunks))).toEqual(expected.save());}finally{await edited.close();}}finally{await document.close();await source.close();}expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([16,32])("flattens %i repeated encoded appearances with bounded writes",async count=>{
 const fs=createMemoryFileSystem();await fs.mkdir("/scratch");const doc=PdfDocument.create(),payload=new TextEncoder().encode("% generated appearance\n".repeat(8192));
 const appearance=doc.cos.allocateObject(cosStream(payload,{compress:false,dict:cosDict({BBox:cosArray([0,0,100,20].map(v=>cosNumber(v)))})})),fields=[];
 for(let i=0;i<count;i++){const page=doc.addPage([200,200]),field=doc.cos.allocateObject(cosDict({T:cosString(`field${i}`),FT:cosName("Tx"),V:cosString("value"),Subtype:cosName("Widget"),Rect:cosArray([10,20,110,40].map(v=>cosNumber(v))),AP:cosDict({N:appearance})}));fields.push(field);dictSet(page.pageDict,"Annots",cosArray([field]));}
 dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"AcroForm",cosDict({Fields:cosArray(fields)}));await fs.writeFile("/input",doc.save());let writes=0,outstanding=0;
 const guarded=new Proxy(fs,{get(owner,key){if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};if(key==="open")return async(...args:Parameters<NonNullable<typeof fs.open>>)=>{const handle=await fs.open!(...args);return new Proxy(handle,{get(target,property){if(property==="write")return async(...args:Parameters<NonNullable<typeof handle.write>>)=>{expect(outstanding).toBe(0);expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536);outstanding+=args[0].length;writes++;try{await Promise.resolve();return await handle.write!(...args);}finally{outstanding-=args[0].length;}};const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;}});};const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;}});
 const storage={fs:guarded,directory:"/scratch"},source=await PdfFileSource.open(guarded,"/input"),document=await PdfRetainedDocument.open(source,storage);
 try{const edited=await editRetainedDocument(document,storage,{flattenForms:true});try{let bytes=0;for await(const chunk of saveRetainedDocumentChunks(edited.document,storage)){expect(chunk.buffer.byteLength).toBeLessThanOrEqual(65536);bytes+=chunk.length;await Promise.resolve();}expect(bytes).toBeGreaterThan(count*payload.length);}finally{await edited.close();}}finally{await document.close();await source.close();}
 expect(writes).toBeGreaterThan(count);expect(outstanding).toBe(0);expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["write","cancel"])("cleans form flattening storage after %s failure",async mode=>{
 const {PdfMutableObjectStore}=await import("../cos/mutable-object-store.js"),{retainedCosObjects}=await import("../cos/retained-objects.js"),{flattenRetainedForms}=await import("./retained-flatten-forms.js");
 const fs=createMemoryFileSystem();await fs.mkdir("/scratch");const doc=PdfDocument.create(),page=doc.addPage(),fields=[];
 for(let i=0;i<512;i++)fields.push(doc.cos.allocateObject(cosDict({T:cosString(`field${i}`),FT:cosName("Tx"),V:cosString("value")})));
 dictSet(doc.cos.resolveDict(doc.cos.rootRef)!,"AcroForm",cosDict({Fields:cosArray(fields)}));dictSet(page.pageDict,"Annots",cosArray(fields));await fs.writeFile("/input",doc.save());
 const controller=new AbortController(),reason=new Error("flatten failed");let armed=false,writes=0;
 const guarded=new Proxy(fs,{get(owner,key){if(key==="open")return async(...args:Parameters<NonNullable<typeof fs.open>>)=>{const handle=await fs.open!(...args);return new Proxy(handle,{get(target,property){if(property==="write")return async(...args:Parameters<NonNullable<typeof handle.write>>)=>{if(armed&&++writes>3){if(mode==="cancel")controller.abort(reason);throw reason;}return handle.write!(...args);};const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;}});};const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;}});
 const storage={fs:guarded,directory:"/scratch"},source=await PdfFileSource.open(guarded,"/input"),input=await PdfRetainedDocument.open(source,storage),store=new PdfMutableObjectStore(storage);let document:PdfRetainedDocument|undefined;
 try{for await(const object of retainedCosObjects(input,storage))await store.set(object);document=await PdfRetainedDocument.openStore(store,storage,{rootRef:input.crossReference.rootRef,version:input.crossReference.version});armed=true;await expect(flattenRetainedForms(document,store,storage,controller.signal)).rejects.toBe(reason);}
 finally{armed=false;await document?.close();await store.close();await input.close();await source.close();}expect(await fs.readdir("/scratch")).toEqual([]);
});
