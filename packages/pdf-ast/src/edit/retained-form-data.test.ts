import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfFileSource } from "../source.js";
import { parseFormDataBytes } from "./forms.js";
import { parseRetainedFormData } from "./retained-form-data.js";

const cases = [
  "# ignored\na=first\nb:Yes\na=last\nc=Off\nx=y:z\n",
  "FieldName: a&amp;b\nFieldValue: first\nFieldValue: second\n---\nFieldType: Button\nFieldName: c\nFieldValue: \n",
  '<xfdf><fields><field name="parent"><field name="child"><value>one&amp;two</value><value>three</value></field><field name="flag"><value>Off</value></field></field></fields></xfdf>',
  '<?xml version="1.0"?><xfdf><field name="a"><value>Yes</value><value>text</value></field><field name="a"><value>last</value></field></xfdf>',
  '<fields><field name="x"/><field name=""><field name="a"><value>one<b/>two</value></field></field></fields>',
  '<fields><field name="x"><value>unclosed <field name="y"><value>two</value></field>',
  '%FDF-1.2\n1 0 obj << /FDF << /Fields [<< /T (a) /V (first) >> << /T (flag) /V /Off >> << /T (a) /V [(one) /Two] >>] >> >> endobj',
  '%FDF-1.2\n1 0 obj << /FDF << /Fields [2 0 R] >> >> endobj\n2 0 obj << /Kids [3 0 R] /T (parent) >> endobj\n3 0 obj << /T (child) /V 42 >> endobj',
  '%FDF-1.2\n3 0 obj << /T (child) /V /On >> endobj\n2 0 obj << /T (parent) /Kids [3 0 R] >> endobj\n1 0 obj << /FDF << /Fields [2 0 R] >> >> endobj',
  '%FDF-1.2\n<< /T (root) /Kids [<< /V true /T (a) >> << /T (b) /V <FEFF006500E9> >>] >>',
  'prefix /FDF ignored /Fields << /T /named /V /custom >>',
  'prefix <fields><field name="a"><value>&#x1F600;</value></field>',
  'prefix\nFieldName: a\nFieldValue: one\nFieldValue: On\nFieldValue: two',
  ' \uFEFF\n<xfdf><field name="a"><value>é😀</value></field></xfdf>',
  '%FDF-1.2\n<< /T (before) /Other << /T (inline) /V (early) >> /T (after) /V (late) /Kids [<< /T (kid) /V /Off >>] >>',
  '%FDF-1.2\n<< /Fields [3 0 R << /T (a) /V (inline) >> 2 0 R] >> 2 0 obj << /T (a) /V (second) >> endobj 3 0 obj << /T (a) /V (first) >> endobj',
  '%FDF-1.2\n<< /Fields [2 0 R] >> 2 0 obj << /T (root) /Kids [2 0 R] /V (value) >> endobj',
  '%FDF-1.2\n1 0 obj << /T (first) /V (one) >> endobj 1 0 obj << /T (last) /V (two) >> endobj << /Fields [1 0 R] >>',
  '%FDF-1.2\n<< /T (array) /V [(a) [(ignored)] /B (c)] >> << /T (empty) /V [] >>',
  '<fields><FIELD name="a"><VALUE>On</value></FIELD><field xname="b"><value>last</value></field></fields>',
  'a=first\nb=On\na=last\n<?xml late',
  '',
];
it.each(cases)("preserves form-data parsing: %s", async text => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const bytes = new TextEncoder().encode(text); await fs.writeFile("/input",bytes);
  const source=await PdfFileSource.open(fs,"/input",{chunkBytes:7});
  try { const actual=[]; for await (const row of parseRetainedFormData(source,{fs,directory:"/scratch"})) actual.push([row.name,row.value]); expect(actual).toEqual([...parseFormDataBytes(bytes)]); }
  finally {await source.close();}
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["text","xfdf","fdf"])("handles chunk boundaries and distant %s format markers",async format=>{
  const text=" ".repeat(4094)+(format==="text"?"name=value\n"+"# comment\n".repeat(2048)+"FieldName: last\nFieldValue: value":format==="xfdf"?'<xfdf><fields><field name="'+"a".repeat(4090)+'"><value>'+"é😀&amp;".repeat(700)+'</value></field></fields></xfdf>':'%FDF-1.2\n<< /T ('+"a".repeat(4090)+') /V ('+"value".repeat(1024)+') >>');
  const bytes=new TextEncoder().encode(text),fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",bytes);const source=await PdfFileSource.open(fs,"/input",{chunkBytes:17});
  try{const rows=[];for await(const row of parseRetainedFormData(source,{fs,directory:"/scratch"}))rows.push([row.name,row.value]);expect(rows).toEqual([...parseFormDataBytes(bytes)]);}finally{await source.close();}expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([256,512])("stages %i generated FDF fields with bounded caller writes",async count=>{
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");let writes=0,outstanding=0;
  const guarded=new Proxy(fs,{get(owner,key){
    if(key==="readFile"||key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};
    if(key==="open")return async(...args:Parameters<NonNullable<typeof fs.open>>)=>{
      const handle=await fs.open!(...args);return new Proxy(handle,{get(target,property){
        if(property==="write")return async(...args:Parameters<NonNullable<typeof handle.write>>)=>{expect(outstanding).toBe(0);expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536);writes++;outstanding+=args[0].length;try{await Promise.resolve();return await handle.write!(...args);}finally{outstanding-=args[0].length;}};
        const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
      }});
    };
    const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;
  }});
  async function* chunks(){const buffer=new Uint8Array(64),encoder=new TextEncoder();for(let i=-1;i<count;i++){const bytes=encoder.encode(i<0?"%FDF-1.2\n":`<< /T (field${i}) /V (value${i}) >>\n`);buffer.set(bytes);yield buffer.subarray(0,bytes.length);}}
  const source=await PdfFileSource.fromStream(guarded,"/scratch",chunks());
  try{let index=0;for await(const row of parseRetainedFormData(source,{fs:guarded,directory:"/scratch"})){expect(row).toEqual({name:`field${index}`,value:`value${index}`});index++;await Promise.resolve();}expect(index).toBe(count);}finally{await source.close();}
  expect(writes).toBeGreaterThan(0);expect(outstanding).toBe(0);expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["cancel","write","return","malformed"])("releases parser backing after %s",async mode=>{
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");await fs.writeFile("/input",new TextEncoder().encode(mode==="malformed"?'<fields><field name="a"><value>&#99999999;</value></field>':"%FDF-1.2\n"+"<< /T (field) /V (value) >>\n".repeat(512)));
  const controller=new AbortController(),reason=new Error("parser storage failed");let writes=0;
  const guarded=new Proxy(fs,{get(owner,key){
    if(key==="open")return async(...args:Parameters<NonNullable<typeof fs.open>>)=>{const handle=await fs.open!(...args);return new Proxy(handle,{get(target,property){
      if(property==="write")return async(...args:Parameters<NonNullable<typeof handle.write>>)=>{if(++writes>8&&(mode==="write"||mode==="cancel")){if(mode==="cancel")controller.abort(reason);throw reason;}return handle.write!(...args);};const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
    }});};const value=Reflect.get(owner,key);return typeof value==="function"?value.bind(owner):value;
  }});
  const source=await PdfFileSource.open(guarded,"/input"),rows=parseRetainedFormData(source,{fs:guarded,directory:"/scratch"},{signal:controller.signal});
  try{if(mode==="return"){expect((await rows.next()).done).toBe(false);await rows.return(undefined);}else if(mode==="malformed")await expect(rows.next()).rejects.toBeInstanceOf(RangeError);else await expect(rows.next()).rejects.toBe(reason);}
  finally{await rows.return(undefined);await source.close();}expect(await fs.readdir("/scratch")).toEqual([]);
});
