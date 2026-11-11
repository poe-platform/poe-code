import type {ImageMetadata,SharpInputOptions} from "../ast.js";

export function isGifBytes(bytes:Uint8Array):boolean {
 return bytes.length>=6&&bytes[0]===71&&bytes[1]===73&&bytes[2]===70&&bytes[3]===56&&(bytes[4]===55||bytes[4]===57)&&bytes[5]===97;
}

/** Read requests and frame events keep the shared animation scanner independent of storage. */
export function* gifAnimationSteps(size:number,start:number,page=0):Generator<number|{frame:number;delay:number},{frames:number;loop:number|undefined;isProgressive:boolean;icc?:Uint8Array;gifApplications?:Record<string,Uint8Array>;properties?:Record<string,string>;gifCommentBytes?:Uint8Array;frame?:ImageMetadata["virtualCanvas"]},number|undefined> {
 const skip=function*(at:number):Generator<number,number,number|undefined>{while(at<size){const length=(yield at++)??0;if(!length)break;at+=length;}return at;};
 const word=function*(at:number):Generator<number,number,number|undefined>{return ((yield at)??0)|(((yield at+1)??0)<<8);};
 const gifApplications: Record<string,Uint8Array> = {};
 let applicationBytes=0;
 let icc:Uint8Array|undefined;
 let frame:ImageMetadata["virtualCanvas"];
 let comments: number[] = [];
 let at=start,pending=0,frames=0,loop:number|undefined,isProgressive=false;
 while(at<size){
  const intro=yield at++;if(intro===59)break;
  if(intro===33){
   const label=yield at++;
   if(label===249){
    const length=(yield at++)??0;
    const low=length>1&&at+1<size?((yield at+1)??0):0;
    const high=length>2&&at+2<size?((yield at+2)??0):0;
    pending=(low|(high<<8))*10;
    at=yield* skip(at+length);
   }
   else if(label===255){
    const length=(yield at++)??0;let name="";
    if(at+length<=size)for(let i=0;i<length;i++)name+=String.fromCharCode((yield at+i)??0);
    at+=length;
    const payload:number[]=[];
    const retain=length===11&&name!=="NETSCAPE2.0"&&frames===page;
    while(at<size){const n=(yield at++)??0;if(!n)break;
     if(name==="NETSCAPE2.0"&&n>=3){const value=yield* word(at+1);loop=value===0?0:value+1;}
     if(retain){
      if(applicationBytes+n>16*1024*1024)throw new Error("GIF application profiles exceed 16 MiB");
      if(at+n>size)throw new Error("Truncated GIF application profile");
      for(let i=0;i<n;i++)payload.push((yield at+i)??0);
      applicationBytes+=n;
     }
     at+=n;
    }
    if(retain){if(name==="ICCRGBG1012")icc=new Uint8Array(payload);else gifApplications[name]=new Uint8Array(payload);}
   }else if(label===254){
    const extension: number[] = [];
    while(at<size){const n=(yield at++)??0;if(!n){if(frames===page)comments=extension;break;}
     if(frames===page && extension.length+n>16*1024*1024)throw new Error("GIF comment exceeds 16 MiB");
     if(frames===page)for(let i=0;i<n&&at<size;i++)extension.push((yield at++)??0);
     else at+=n;
    }
   }else at=yield* skip(at);
  }else if(intro===44){
   if(at+9>size)break;
   const width=yield* word(at+4),height=yield* word(at+6);
   if(width===0||height===0)throw new Error("negative or zero image size");
   const flags=(yield at+8)??0;
   if(frames===page){
    isProgressive=Boolean(flags&64);
    frame={width,height,x:yield* word(at),y:yield* word(at+2)};
   }
   yield {frame:frames++,delay:pending};
   at+=9;if(flags&128)at+=3*(1<<((flags&7)+1));at=yield* skip(at+1);
  }
  // Ignore stray bytes only between blocks; payloads retain their declared lengths.
 }
 const gifCommentBytes = new Uint8Array(comments);
 // Without a looping extension, an animation plays exactly once.
 return {frame,...(icc?{icc}:{}),...(Object.keys(gifApplications).length?{gifApplications}:{}),frames,isProgressive,loop:loop ?? (frames>1?1:undefined),...(comments.length?{properties:{comment:new TextDecoder().decode(gifCommentBytes)},gifCommentBytes}:{})};
}

export function gifMetadataFields(width:number,height:number,size:number,frames:number,loop:number|undefined,options?:Pick<SharpInputOptions,"animated"|"page"|"pages"|"coalesce">,frame?:ImageMetadata["virtualCanvas"]):ImageMetadata {
 const total=Math.max(1,frames),multi=options?.coalesce!==false&&(options?.animated===true||options?.pages===-1||(options?.pages!==undefined&&options.pages>1)),page=Math.max(0,options?.page??0);
 const pages=multi?options?.pages!==undefined&&options.pages>0?Math.min(options.pages,Math.max(1,total-page)):Math.max(1,total-page):1;
 return {format:"gif",width,height:height*pages,space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true,pages:total,
  ...(options?.coalesce===false&&frame?{width:frame.width,height:frame.height,virtualCanvas:{width,height,x:frame.x,y:frame.y}}:{}),
  ...(multi&&total>1?{pageHeight:height}:{}),...(loop!==undefined?{loop}:total>1?{loop:0}:{}),size};
}
