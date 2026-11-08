import type {RgbaColor} from "../ast.js";

export function extendedCoordinate(c:number,size:number,mode:"background"|"copy"|"repeat"|"mirror"):number {
  if(c>=0 && c<size) return c;
  if(mode==="copy") return Math.max(0,Math.min(size-1,c));
  if(mode==="repeat") return ((c%size)+size)%size;
  if(mode==="mirror") {const period=size*2,m=((c%period)+period)%period;return m<size?m:period-1-m;}
  return -1;
}

/** Fixed channel histograms replace sorted arrays proportional to the filter area. */
export class PixelMedian {
  private readonly bins=new Float64Array(1024);
  private count=0;
  clear():void {this.bins.fill(0);this.count=0;}
  add(r:number,g:number,b:number,a:number):void {
    this.bins[r]!++;this.bins[256+g]!++;this.bins[512+b]!++;this.bins[768+a]!++;this.count++;
  }
  pixel():number {
    const middle=Math.floor(this.count/2);let result=0;
    for(let channel=0;channel<4;channel++) {
      let count=0;
      for(let value=0;value<256;value++) {count+=this.bins[channel*256+value]!;if(count>middle) {result|=value<<(8*channel);break;}}
    }
    return result;
  }
}

export function trimBackground(reference:RgbaColor,threshold:number):(r:number,g:number,b:number,a:number)=>boolean {
  const alpha=reference.a/255,r=reference.r*alpha,g=reference.g*alpha,b=reference.b*alpha;
  return (pr,pg,pb,pa)=>Math.abs(pr*(pa/255)-r)<=threshold && Math.abs(pg*(pa/255)-g)<=threshold && Math.abs(pb*(pa/255)-b)<=threshold && Math.abs(pa-reference.a)<=threshold;
}
