import type {RgbaImage} from "../ast.js";

/** Exact indexed output only; transformed colors must still fit without quantization. */
export class BmpPalette {
 readonly colors = new Map<number,number>();
 private bilevel = true;
 constructor(private readonly gray: boolean) {}
 static forImage(image: Pick<RgbaImage,"hasAlpha"|"space"|"isPalette">): BmpPalette | undefined {
  return !image.hasAlpha && (image.space === "b-w" || image.isPalette) ? new BmpPalette(image.space === "b-w") : undefined;
 }
 add(r:number,g:number,b:number,a:number): boolean {
  if(a!==255 || this.gray && (r!==g || r!==b)) return false;
  this.bilevel &&= r===g && r===b && (r===0 || r===255);
  const color=r*65536+g*256+b;
  if(!this.colors.has(color)) {
   if(this.colors.size===256)return false;
   this.colors.set(color,this.colors.size);
  }
  return true;
 }
 get depth(): number {return this.bilevel?1:this.gray?8:this.colors.size<=2?1:this.colors.size<=16?4:8;}
 index(r:number,g:number,b:number): number {return this.bilevel?r/255:this.gray?r:this.colors.get(r*65536+g*256+b)!;}
 bytes(step:number, depth = this.depth): Uint8Array {
  const bytes=new Uint8Array(2**depth*step);
  if(this.bilevel || this.gray) {
   for(let i=0;i<2**this.depth;i++)bytes.fill(this.bilevel?i*255:i,i*step,i*step+3);
  } else {
   for(const [color,index] of this.colors)bytes.set([color&255,color>>>8&255,color>>>16],index*step);
  }
  return bytes;
 }
}
