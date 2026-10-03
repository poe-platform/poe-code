import type {RgbaImage,ImageAstNode} from "../ast.js";
import {extendedCoordinate} from "./canvas-math.js";
export interface ClaheOptions {readonly width:number;readonly height:number;readonly maxSlope:number;}
/** Four fixed histograms; coordinates are calculated instead of image-sized tables. */
export class ClaheWindow {
 readonly width:number;readonly height:number;readonly halfWidth:number;readonly halfHeight:number;
 readonly channels:readonly number[];
 private readonly histograms=[new Int32Array(256),new Int32Array(256),new Int32Array(256),new Int32Array(256)];
 private readonly maxSlope:number;private readonly gray:boolean;
 constructor(private readonly image:Pick<RgbaImage,"width"|"height"|"channels"|"space">,options:ClaheOptions) {
  this.width=Math.max(1,options.width||8);this.height=Math.max(1,options.height||8);
  this.halfWidth=Math.floor(this.width/2);this.halfHeight=Math.floor(this.height/2);
  this.maxSlope=options.maxSlope!==undefined?Math.max(0,options.maxSlope):3;
  this.channels=image.channels===1?[0]:image.channels===2 || image.space==="b-w" && image.channels>1?[0,3]:image.channels===4?[0,1,2,3]:[0,1,2];
  this.gray=image.channels<=2 || image.space==="b-w";
 }
 position(x:number,y:number):number {
  return extendedCoordinate(y,this.image.height,"mirror")*this.image.width+extendedCoordinate(x,this.image.width,"mirror");
 }
 clear():void {for(const hist of this.histograms) hist.fill(0);}
 add(pixel:number,delta:number):void {for(const ch of this.channels) this.histograms[ch]![pixel>>>(ch*8)&255]!+=delta;}
 pixel(pixel:number):number {
  let result=pixel;
  for(const ch of this.channels) {
   const hist=this.histograms[ch]!,target=pixel>>>(ch*8)&255;
   let sum=0;
   if(this.maxSlope>0) {
    let clipLe=0,totalClipped=0;
    for(let i=0;i<256;i++) {const h=hist[i]!;if(h>this.maxSlope) {totalClipped+=h-this.maxSlope;if(i<=target) clipLe+=this.maxSlope;} else if(i<=target) clipLe+=h;}
    sum=clipLe+Math.floor(totalClipped*(target+1)/256);
   } else for(let i=0;i<=target;i++) sum+=hist[i]!;
   const value=Math.max(0,Math.min(255,Math.floor(255*sum/(this.width*this.height))));
   result=ch===0 && this.gray?(result&0xff000000)|value|value<<8|value<<16:(result&~(255<<(ch*8)))|value<<(ch*8);
  }
  return result;
 }
}

/** Sharp promotes grayscale sources unless the caller explicitly keeps grayscale. */
export function prepareClaheImage<T extends Pick<RgbaImage,"channels"|"space"|"hasAlpha">>(image:T,nodes:readonly ImageAstNode[]):T {
 const explicitBw=nodes.some(node=>node.kind==="grayscale" || node.kind==="toColorspace" && (node.space==="b-w" || node.space==="grey16"));
 if(!explicitBw && (image.channels===1 || image.channels===2)) return {...image,channels:image.channels===2?4:3,space:"srgb",hasAlpha:image.channels===2};
 return image;
}
