import {expect,test} from "vitest";
import * as svg from "./svg-storage.js";
import {decodeSvgImage} from "./svg-pdf.js";
import type {ImageByteSource,ImageByteStorage} from "./png-storage.js";

function backing(){
 const pages=new Map<number,Uint8Array>();let size=0;const borrowed=new Uint8Array(4096);
 const storage:ImageByteStorage={allocate(length){const at=size;size+=length;return at;},async write(position,bytes){expect(bytes.length).toBeLessThanOrEqual(4096);for(let i=0;i<bytes.length;i++){const at=position+i,page=Math.floor(at/4096);let data=pages.get(page);if(!data){data=new Uint8Array(4096);pages.set(page,data);}data[at%4096]=bytes[i]!;}},async read(position,length){expect(length).toBeLessThanOrEqual(4096);for(let i=0;i<length;i++)borrowed[i]=pages.get(Math.floor((position+i)/4096))?.[(position+i)%4096]??0;return borrowed.subarray(0,length);}};
 return {storage,async pixels(position:number,length:number){const out=new Uint8Array(length);for(let at=0;at<length;at+=4096)out.set(await storage.read(position+at,Math.min(4096,length-at)),at);return out;}};
}

const picture=`<svg width="48" height="36" viewBox="-2 -3 48 36"><rect width="40" height="30" fill="blue" opacity="0.4" rx="3"/><g transform="translate(3 1) rotate(12 10 10)"><circle cx="12" cy="12" r="8" fill="red" stroke="green" stroke-width="2"/><ellipse cx="25" cy="9" rx="6" ry="3" fill="none" stroke="purple"/><path d="M2 20l5 -4h4v8C15 20 20 12 22 20Q28 28 32 19z" fill="yellow" opacity="0.6" stroke="black"/><polyline points="1,1 12,4 14,8" fill="none" stroke="cyan"/></g><polygon points="1 25,8 24,4 32" fill="white"/><text x="24" y="30" font-size="10" text-anchor="middle">A&amp;g</text></svg>`;

test("renders retained SVG source ranges into caller storage with identical pixels",async()=>{
 const bytes=new TextEncoder().encode(picture),borrowed=new Uint8Array(4096);let reads=0;
 const source:ImageByteSource={size:bytes.length,async read(position,length){expect(length).toBeLessThanOrEqual(4096);reads++;borrowed.set(bytes.subarray(position,position+length));return borrowed.subarray(0,length);}};
 const caller=backing(),image=await svg.decodeSvgSourceToStorage(source,caller.storage,new AbortController().signal);
 expect(image).toMatchObject({width:48,height:36,format:'svg'});expect(await caller.pixels(image.position,48*36*4)).toEqual(decodeSvgImage(bytes).data);expect(reads).toBeGreaterThan(0);
});

for(const [name,body,root]of [
 ['nested transforms','<g transform="translate(1 2) rotate(31 4 3)"><g transform="scale(.9 1.1) matrix(1 .1 .2 1 .3 .4)"><rect x="1" y="2" width="9" height="7" stroke="red"/><text x="9" y="10" text-anchor="end">A</text></g><circle cx="9" cy="9" r="2"/></g>','viewBox="-1 -2 19 17"'],
 ['numeric syntax','<polygon points=",1,2,3,4,5,6,"/><polyline points="1 bad 2 0x4 5"/><rect width="0.0000000000000000001%" height="4"/><g transform="fooscale(,2,) rotate( bad 3 4 5 ) matrix(1 0 0 1 2 3 99)"><rect width="4" height="4"/></g>',''],
 ['interior BOM','<text x="1" y="9">A\ufeffB</text>',''],
 ['UTF16 text','<text x="1" y="9">A\ufeffé😀&amp;quot;<b>G</b>&lt;x&gt;&#39;&apos;&amp;#39;</text>',''],
 ['legacy tags','<TEXT x="2" y="9">Hi</TEXT><g/><rect width="3" height="3"/><text x="2"><line x1="1" y1="1" x2="9" y2="9"/></text ><g transform="translate(2)"><circle r="2"/></g>',''],
] as const)test(`retained SVG preserves ${name}`,async()=>{
 const bytes=new TextEncoder().encode('<svg width="23" height="19" '+root+'>'+body+'</svg>'),source:ImageByteSource={size:bytes.length,async read(position,length){return bytes.subarray(position,position+length);}},caller=backing();
 const image=await svg.decodeSvgSourceToStorage(source,caller.storage,new AbortController().signal);
 expect(await caller.pixels(image.position,image.width*image.height*4)).toEqual(decodeSvgImage(bytes).data);
});

test('preserves retained source failures after metadata inspection',async()=>{
 const bytes=new TextEncoder().encode('<svg width="2" height="2">'+' '.repeat(8192)+'</svg>'),failure=new Error('retained source failed'),source:ImageByteSource={size:bytes.length,async read(position,length){if(position>=4096)throw failure;return bytes.subarray(position,position+length);}},caller=backing();
 await expect(svg.decodeSvgSourceToStorage(source,caller.storage,new AbortController().signal)).rejects.toBe(failure);
});

test('observes cancellation during a long non-painting SVG scan',async()=>{
 const bytes=new TextEncoder().encode('<svg width="2" height="2">'+' '.repeat(262144)+'</svg>'),source:ImageByteSource={size:bytes.length,async read(position,length){return bytes.subarray(position,position+length);}},caller=backing(),controller=new AbortController(),reason=new Error('cancel source scan'),write=caller.storage.write;
 let timer:ReturnType<typeof setTimeout>|undefined;caller.storage.write=async(...args)=>{await write(...args);timer??=setTimeout(()=>controller.abort(reason),0);};
 try{await expect(svg.decodeSvgSourceToStorage(source,caller.storage,controller.signal)).rejects.toBe(reason);}finally{clearTimeout(timer);}
});
