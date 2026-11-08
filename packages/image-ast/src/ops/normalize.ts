import {srgbToLab,labToSrgb} from "./color.js";

export interface NormalizationScale {readonly factor:number;readonly offset:number}
/** Fixed-size luminance statistics shared by buffered and caller-backed images. */
export class NormalizationHistogram {
  private readonly bins=new Uint32Array(256);
  private highestBin=0;
  private minimum=Infinity;
  private maximum=-Infinity;
  constructor(private readonly count:number) {}
  add(r:number,g:number,b:number):void {
    const [luminance]=srgbToLab(r,g,b);
    this.minimum=Math.min(this.minimum,luminance);
    this.maximum=Math.max(this.maximum,luminance);
    const bin=Math.max(0,Math.min(255,Math.trunc(luminance)));
    this.highestBin=Math.max(this.highestBin,bin);
    this.bins[bin]!++;
  }
  scale(options?:{readonly lower?:number;readonly upper?:number}):NormalizationScale|undefined {
    const lower=Math.max(0,Math.min(100,options?.lower??1));
    const upper=Math.max(lower,Math.min(100,options?.upper??99));
    const percentile=(percent:number):number=>{
      const width=this.highestBin+1,threshold=(percent/100)*width;
      let cumulative=0;
      for(let i=0;i<=this.highestBin;i++) {
        cumulative+=this.bins[i]!;
        if(Math.trunc(cumulative*this.highestBin/this.count)>threshold) return i;
      }
      return width;
    };
    const minimum=lower<=0?Math.trunc(this.minimum):percentile(lower);
    const maximum=upper>=100?Math.trunc(this.maximum):percentile(upper);
    const range=maximum-minimum;
    if(Math.abs(range)<2) return undefined;
    const factor=100/range;
    return {factor,offset:-(factor*minimum)};
  }
}
export function normalizeRgb(r:number,g:number,b:number,scale:NormalizationScale):[number,number,number] {
  const [luminance,a,bLab]=srgbToLab(r,g,b);
  // Preserve the former Float32 plane rounding without retaining those planes.
  return labToSrgb(Math.fround(luminance)*scale.factor+scale.offset,Math.fround(a),Math.fround(bLab));
}
