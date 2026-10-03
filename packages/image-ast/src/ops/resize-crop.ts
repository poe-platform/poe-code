/** Fixed histograms preserve the band and alpha arithmetic used by smart crop. */
export class EntropyHistogram {
  private readonly histograms=Array.from({length:4},()=>new Int32Array(256));
  private readonly bands:number;
  constructor(channels:number,private readonly hasAlpha:boolean) {this.bands=hasAlpha?4:channels===1?1:3;}
  add(r:number,g:number,b:number,a:number):void {
    if(this.hasAlpha) {
      const factor=Math.fround(a/255);
      r=Math.trunc(Math.fround(r*factor));g=Math.trunc(Math.fround(g*factor));b=Math.trunc(Math.fround(b*factor));
      this.histograms[3]![a]!++;
    }
    this.histograms[0]![r]!++;
    if(this.bands>=3) {this.histograms[1]![g]!++;this.histograms[2]![b]!++;}
  }
  entropy():number {
    const bins=new Int32Array(256);let sum=0;
    for(let i=0;i<256;i++) {let count=0;for(let c=0;c<this.bands;c++) count+=this.histograms[c]![i]!;bins[i]=count;sum+=count;}
    let value=0;
    if(sum>0) for(const count of bins) if(count>0) {const p=count/sum;value-=p*Math.log2(p);}
    return value;
  }
}
