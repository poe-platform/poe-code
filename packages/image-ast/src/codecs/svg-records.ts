import type {ImageByteStorage} from "./png-storage.js";

/** Linked caller-backed pages. Only the active page and the final record stay in
 * working memory; sequential raster passes can rewind without an index array. */
export class SvgRecords {
 private head=-1;
 private position=-1;
 private page=new Uint8Array(4096);
 private used=0;
 private count=0;
 private sealed=false;
 private last:readonly number[]=[];
 private readPage=-1;
 private readStart=0;
 private readBytes=new Uint8Array(0);
 private readonly capacity:number;
 constructor(private readonly width:number,private readonly storage:ImageByteStorage,private readonly signal:AbortSignal){
  if(!Number.isInteger(width)||width<1||width>7)throw new RangeError("Invalid SVG record width");
  this.capacity=Math.floor((4096-16)/(width*8));
 }
 get length():number{return this.count;}
 private allocate():number{
  const position=this.storage.allocate(4096);
  if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(position+4096))throw new RangeError("Invalid SVG backing allocation");
  return position;
 }
 async push(record:readonly number[]):Promise<void>{
  this.signal.throwIfAborted();if(this.sealed||record.length!==this.width)throw new Error("Invalid SVG record append");
  if(this.head<0)this.head=this.position=this.allocate();
  if(this.used===this.capacity){
   const next=this.allocate(),view=new DataView(this.page.buffer);
   view.setFloat64(0,next,true);view.setUint32(8,this.used,true);
   await this.storage.write(this.position,this.page,{signal:this.signal});this.signal.throwIfAborted();
   this.position=next;this.page=new Uint8Array(4096);this.used=0;
  }
  const view=new DataView(this.page.buffer);
  for(let index=0;index<this.width;index++)view.setFloat64(16+(this.used*this.width+index)*8,record[index]!,true);
  this.used++;this.count++;this.last=Array.from(record);
 }
 async finish():Promise<void>{
  this.signal.throwIfAborted();if(this.sealed)return;
  if(this.position>=0){
   const view=new DataView(this.page.buffer);view.setFloat64(0,-1,true);view.setUint32(8,this.used,true);
   await this.storage.write(this.position,this.page,{signal:this.signal});this.signal.throwIfAborted();
  }
  this.page=new Uint8Array(0);this.sealed=true;
 }
 async get(index:number):Promise<readonly number[]>{
  this.signal.throwIfAborted();
  if(!this.sealed||!Number.isSafeInteger(index)||index<0||index>=this.count)throw new RangeError("Invalid SVG record index");
  if(index===this.count-1)return this.last;
  if(this.readPage<0||index<this.readStart){this.readPage=this.head;this.readStart=0;this.readBytes=new Uint8Array(0);}
  while(true){
   if(!this.readBytes.length){
    const borrowed=await this.storage.read(this.readPage,4096,{signal:this.signal});this.signal.throwIfAborted();
    if(!(borrowed instanceof Uint8Array)||borrowed.length!==4096)throw new Error("Truncated SVG backing records");
    this.readBytes=new Uint8Array(borrowed);
   }
   const view=new DataView(this.readBytes.buffer),count=view.getUint32(8,true),next=view.getFloat64(0,true);
   if(!count||count>this.capacity||this.readStart+count>this.count)throw new Error("Invalid SVG backing records");
   if(index<this.readStart+count){
    const record:number[]=[];for(let field=0;field<this.width;field++)record.push(view.getFloat64(16+((index-this.readStart)*this.width+field)*8,true));return record;
   }
   if(!Number.isSafeInteger(next)||next<0)throw new Error("Truncated SVG backing records");
   this.readPage=next;this.readStart+=count;this.readBytes=new Uint8Array(0);
  }
 }
}
