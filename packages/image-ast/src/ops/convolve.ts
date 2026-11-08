import type {RgbaImage} from "../ast.js";

function byte(value:number):number {return Math.max(0,Math.min(255,Math.trunc(value)));}

/** Accumulates one convolution sample without an image-sized premultiplication plane. */
export class ConvolutionPixel {
  private r=0;private g=0;private b=0;private a=0;
  private readonly premultiplied:boolean;
  private readonly useAlpha:boolean;
  private readonly scale:number;
  constructor(image:Pick<RgbaImage,"isPremultiplied"|"hasAlpha"|"channels">,scale:number,private readonly offset:number) {
    this.premultiplied=Boolean(image.isPremultiplied);
    this.useAlpha=this.premultiplied || image.hasAlpha || image.channels===4 || image.channels===2;
    this.scale=scale===0?1:scale;
  }
  clear():void {this.r=0;this.g=0;this.b=0;this.a=0;}
  add(r:number,g:number,b:number,a:number,weight:number):void {
    if(this.useAlpha && !this.premultiplied) {
      const factor=Math.fround(a/255);
      r=byte(Math.fround(r*factor));g=byte(Math.fround(g*factor));b=byte(Math.fround(b*factor));
    }
    this.r+=r*weight;this.g+=g*weight;this.b+=b*weight;
    if(this.useAlpha) this.a+=a*weight;
  }
  pixel(originalAlpha:number):number {
    let r=Math.fround(this.r/this.scale+this.offset),g=Math.fround(this.g/this.scale+this.offset),b=Math.fround(this.b/this.scale+this.offset);
    const a=this.useAlpha?Math.fround(this.a/this.scale+this.offset):originalAlpha;
    if(this.useAlpha && !this.premultiplied) {
      const factor=a===0?0:Math.fround(255/a);
      r=a===0?0:Math.fround(factor*r);g=a===0?0:Math.fround(factor*g);b=a===0?0:Math.fround(factor*b);
    }
    return byte(r) | byte(g)<<8 | byte(b)<<16 | byte(a)<<24;
  }
}
