import {parseColor,type RgbaImage,type SharpInputOptions} from "../ast.js";
type JoinImage=Pick<RgbaImage,"width"|"height"|"hasAlpha">;

/** Common layout for buffered and caller-backed image joins. */
export class JoinLayout {
 readonly metadata:Omit<RgbaImage,"data"|"data16">;
 readonly background:number;
 private readonly cellW:number;
 private readonly cellH:number;
 private readonly cols:number;
 private readonly shim:number;
 private readonly halign:string;
 private readonly valign:string;
 constructor(images:readonly JoinImage[],options?:SharpInputOptions){
  const n=images.length,join=options?.join;
  this.cellW=images.reduce((max,image)=>Math.max(max,image.width),-Infinity);
  this.cellH=images.reduce((max,image)=>Math.max(max,image.height),-Infinity);
  this.cols=Math.min(n,Math.max(1,join?.across??1));this.shim=Math.max(0,join?.shim??0);
  const rows=Math.ceil(n/this.cols),width=this.cols*this.cellW+(this.cols-1)*this.shim,height=rows*this.cellH+(rows-1)*this.shim;
  const bg=parseColor(join?.background??{r:0,g:0,b:0,alpha:1},255),hasAlpha=images.some(image=>image.hasAlpha)||bg.a<255;
  this.background=(((hasAlpha?bg.a:255)<<24)|(bg.b<<16)|(bg.g<<8)|bg.r)>>>0;
  this.halign=join?.halign??"left";this.valign=join?.valign??"top";
  const pageHeight=join?.animated&&n>0?Math.floor(height/n):0,animated=Boolean(join?.animated)&&pageHeight>0&&height%pageHeight===0&&height/pageHeight===n;
  this.metadata={width,height,format:"raw",space:"srgb",channels:hasAlpha?4:3,depth:"uchar",density:options?.density??72,hasAlpha,...(animated?{pages:n,pageHeight}:{})};
 }
 placement(index:number,image:JoinImage):{left:number;top:number}{
  const dx=this.halign==="centre"||this.halign==="center"?Math.floor((this.cellW-image.width)/2):this.halign==="right"||this.halign==="high"?this.cellW-image.width:0;
  const dy=this.valign==="centre"||this.valign==="center"?Math.floor((this.cellH-image.height)/2):this.valign==="bottom"||this.valign==="high"?this.cellH-image.height:0;
  return {left:index%this.cols*(this.cellW+this.shim)+dx,top:Math.floor(index/this.cols)*(this.cellH+this.shim)+dy};
 }
}
