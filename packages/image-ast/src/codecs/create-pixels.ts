import {parseColor,type RgbaImage,type SharpInputOptions} from "../ast.js";
import {checkLimitInputPixels} from "../limits.js";
/** Deterministic pixel generation with state independent of chunk boundaries. */
export class CreatedPixels {
 readonly metadata:Omit<RgbaImage,"data"|"data16">;
 private readonly background;
 private readonly noise;
 private seed:number;
 constructor(options:SharpInputOptions & {create:NonNullable<SharpInputOptions["create"]>}) {
  const {width,height,channels,pageHeight,background,noise}=options.create;
  checkLimitInputPixels(width,height,options);
  this.background=parseColor(background??{r:0,g:0,b:0,alpha:1},255);
  this.noise=noise&&(noise.type===undefined||noise.type==="gaussian")?{mean:noise.mean??128,sigma:noise.sigma??30}:undefined;
  const mean=this.noise?.mean??128,sigma=this.noise?.sigma??30;
  this.seed=(width*73856093)^(height*19349663)^Math.round(mean*100)^Math.round(sigma*100)^0x9e3779b9;
  this.metadata={width,height,format:"raw",space:channels<3?"b-w":"srgb",channels,depth:"uchar",density:options.density??72,hasAlpha:channels===2||channels===4,...(pageHeight!==undefined?{pageHeight,pages:Math.max(1,Math.floor(height/pageHeight))}:{})};
 }
 private uniform():number {
  this.seed=(this.seed+0x6d2b79f5)|0;
  let t=Math.imul(this.seed^(this.seed>>>15),1|this.seed);
  t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296;
 }
 private sample():number {
  const u1=Math.max(1e-12,this.uniform()),u2=this.uniform();
  const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  return Math.max(0,Math.min(255,Math.floor(this.noise!.mean+this.noise!.sigma*z)));
 }
 fill(data:Uint8Array):void {
  const channels=this.metadata.channels,bg=this.background;
  for(let i=0;i<data.length;i+=4) {
   if(this.noise) {
    if(channels<3) {
     const value=this.sample();data[i]=value;data[i+1]=value;data[i+2]=value;data[i+3]=channels===2?this.sample():255;
    } else {data[i]=this.sample();data[i+1]=this.sample();data[i+2]=this.sample();data[i+3]=channels===4?this.sample():255;}
   } else {data[i]=bg.r;data[i+1]=bg.g;data[i+2]=bg.b;data[i+3]=channels===4?bg.a:255;}
  }
 }
}
