/** RLE packets are at most 258 bytes, including the header and word padding. */
export function bmpRlePacketSize(count: number, value: number, bpp: number): number {
 if(count!==0||value<2) return 2;
 if(value===2) return 4;
 const bytes=bpp===4?Math.ceil(value/2):value;
 return 2+bytes+(bytes&1);
}

/** Shared cursor and packet interpretation for buffered and retained-storage BMPs. */
export class BmpRle {
 private x=0;
 private y=0;
 done=false;
 constructor(private readonly width:number,private readonly height:number,private readonly bpp:number,topDown:boolean) {
  if(topDown) throw new Error("Top-down BMP RLE is invalid");
 }
 packet(bytes:Uint8Array):{x:number;y:number;indices:Uint8Array} {
  const count=bytes[0]!,value=bytes[1]!;
  if(bytes.length<2||bytes.length!==bmpRlePacketSize(count,value,this.bpp)) throw new Error("Truncated BMP RLE packet");
  const x=this.x,y=this.height-1-this.y;
  let length=0;
  if(count!==0) length=count;
  else if(value===0) {this.x=0;this.y++;}
  else if(value===1) this.done=true;
  else if(value===2) {this.x+=bytes[2]!;this.y+=bytes[3]!;}
  else length=value;
  if(this.x>this.width||this.y>this.height||(!this.done&&this.y===this.height&&(length>0||value===2))||this.x+length>this.width) throw new Error("BMP RLE packet exceeds image dimensions");
  const indices=new Uint8Array(length);
  for(let i=0;i<length;i++) {
   const packed=count!==0?value:bytes[2+(this.bpp===4?i>>>1:i)]!;
   indices[i]=this.bpp===4?((i&1)===0?packed>>>4:packed&15):packed;
  }
  this.x+=length;
  return {x,y,indices};
 }
}
