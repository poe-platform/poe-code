import type {PdfPixelStorage} from "../ast.js";
import type {StrokePoint} from "./stroke.js";

const PAGE_BYTES=4096, POINTS_PER_PAGE=(PAGE_BYTES-16)/16;
type Io=(action:()=>Promise<void>)=>Generator<null,void,void>;

/** Bidirectional point pages support AGG's forward/reverse join traversal with
 * one write page and one read cache. All other bytes belong to caller storage. */
export class StoredStrokePoints {
 private readonly bytes=new Uint8Array(PAGE_BYTES);
 private readonly view=new DataView(this.bytes.buffer);
 private readonly cache=new Uint8Array(PAGE_BYTES);
 private readonly cachedView=new DataView(this.cache.buffer);
 private head=-1;
 private tail=-1;
 private tailIndex=0;
 private cachedPosition=-1;
 private cachedIndex=0;
 private used=0;
 private count=0;
 private trimmed=false;
 constructor(private readonly storage:PdfPixelStorage,private readonly io:Io,private readonly signal?:AbortSignal){
  this.view.setFloat64(0,-1,true);this.view.setFloat64(8,-1,true);
 }
 get length():number{return this.count;}
 create():StoredStrokePoints{return new StoredStrokePoints(this.storage,this.io,this.signal);}
 private allocate():number{
  const at=this.storage.allocate(PAGE_BYTES);
  if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(at+PAGE_BYTES))throw new RangeError("Invalid stroke point allocation");
  return at;
 }
 *push(point:StrokePoint):Generator<null,void,void>{
  this.signal?.throwIfAborted();
  if(this.trimmed)throw new Error("Cannot append to a finalized stroke point list");
  if(!Number.isSafeInteger(this.count+1))throw new RangeError("Stroke point count overflow");
  if(this.used===POINTS_PER_PAGE){
   if(this.tail===-1)this.head=this.tail=this.allocate();
   const next=this.allocate(),previous=this.tail;
   this.view.setFloat64(0,next,true);
   yield* this.io(()=>this.storage.write(previous,this.bytes,this.signal?{signal:this.signal}:undefined));
   this.tail=next;this.tailIndex++;this.used=0;
   this.view.setFloat64(0,-1,true);this.view.setFloat64(8,previous,true);
  }
  const at=16+this.used++*16;
  this.view.setFloat64(at,point[0],true);this.view.setFloat64(at+8,point[1],true);this.count++;
 }
 /** Normalization may remove the final duplicate only after all points arrive. */
 trimLast():void{
  if(this.count===0)throw new RangeError("Empty stroke point list");
  this.count--;this.trimmed=true;
 }
 private *page(position:number,index:number):Generator<null,DataView,void>{
  if(position===this.tail)return this.view;
  if(!Number.isSafeInteger(position)||position<0)throw new Error("Invalid stroke point page");
  if(position!==this.cachedPosition){
   yield* this.io(async()=>{
    const bytes=await this.storage.read(position,PAGE_BYTES,this.signal?{signal:this.signal}:undefined);
    if(bytes.length!==PAGE_BYTES)throw new Error("Incomplete stroke point page");
    this.cache.set(bytes);
   });
   this.cachedPosition=position;this.cachedIndex=index;
  }
  return this.cachedView;
 }
 *get(index:number):Generator<null,StrokePoint,void>{
  this.signal?.throwIfAborted();
  if(!Number.isSafeInteger(index)||index<0||index>=this.count)throw new RangeError("Invalid stroke point index");
  const target=Math.floor(index/POINTS_PER_PAGE);
  let current=this.cachedPosition===-1?0:this.cachedIndex,position=this.cachedPosition===-1?this.head:this.cachedPosition;
  if(target<Math.abs(target-current)){current=0;position=this.head;}
  if(this.tailIndex-target<Math.abs(target-current)){current=this.tailIndex;position=this.tail;}
  while(current!==target){
   const page=yield* this.page(position,current);
   const forward=target>current;position=page.getFloat64(forward?0:8,true);current+=forward?1:-1;
  }
  const page=yield* this.page(position,current),at=16+(index%POINTS_PER_PAGE)*16;
  return [page.getFloat64(at,true),page.getFloat64(at+8,true)];
 }
}
