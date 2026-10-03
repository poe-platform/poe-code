import type {ImageMetadata,SharpInputOptions} from "../ast.js";

export function isGifBytes(bytes:Uint8Array):boolean {
 return bytes.length>=6&&bytes[0]===71&&bytes[1]===73&&bytes[2]===70&&bytes[3]===56&&(bytes[4]===55||bytes[4]===57)&&bytes[5]===97;
}

/** Read requests and frame events keep the shared animation scanner independent of storage. */
export function* gifAnimationSteps(size:number,start:number):Generator<number|{frame:number;delay:number},{frames:number;loop:number|undefined},number|undefined> {
 const skip=function*(at:number):Generator<number,number,number|undefined>{while(at<size){const length=(yield at++)??0;if(!length)break;at+=length;}return at;};
 const word=function*(at:number):Generator<number,number,number|undefined>{return ((yield at)??0)|(((yield at+1)??0)<<8);};
 let at=start,pending=100,frames=0,loop:number|undefined;
 while(at<size){
  const intro=yield at++;if(intro===59)break;
  if(intro===33){
   const label=yield at++;
   if(label===249){const length=(yield at++)??0;if(length>=4&&at+length<=size)pending=(yield* word(at+1))*10;at=yield* skip(at+length);}
   else if(label===255){
    const length=(yield at++)??0;let name="";
    if(at+length<=size)for(let i=0;i<length;i++)name+=String.fromCharCode((yield at+i)??0);
    at+=length;
    while(at<size){const n=(yield at++)??0;if(!n)break;
     if((name.startsWith("NETSCAPE")||name.startsWith("ANIMEXTS"))&&n>=3&&(yield at)===1){const value=yield* word(at+1);loop=value===0?0:value+1;}
     at+=n;
    }
   }else at=yield* skip(at);
  }else if(intro===44){
   if(at+9>size)break;yield {frame:frames++,delay:pending};pending=100;
   const flags=(yield at+8)??0;at+=9;if(flags&128)at+=3*(1<<((flags&7)+1));at=yield* skip(at+1);
  }else break;
 }
 return {frames,loop};
}

export function gifMetadataFields(width:number,height:number,size:number,frames:number,loop:number|undefined,options?:Pick<SharpInputOptions,"animated"|"page"|"pages">):ImageMetadata {
 const total=Math.max(1,frames),multi=options?.animated===true||options?.pages===-1||(options?.pages!==undefined&&options.pages>1),page=Math.max(0,options?.page??0);
 const pages=multi?options?.pages!==undefined&&options.pages>0?Math.min(options.pages,Math.max(1,total-page)):Math.max(1,total-page):1;
 return {format:"gif",width,height:height*pages,space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true,pages:total,
  ...(multi&&total>1?{pageHeight:height}:{}),...(loop!==undefined?{loop}:total>1?{loop:0}:{}),size};
}
