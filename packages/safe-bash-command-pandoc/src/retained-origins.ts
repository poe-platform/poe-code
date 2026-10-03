import {IntegerTable,type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";

/** Preserve the buffered Lua adapter's structural sharing: an image target keeps
 * its parser origin only when the same-position URL/title tuple is unchanged.
 * Maps and traversal frames live on tape, including arbitrary metadata keys. */
export class RetainedOrigins {
  private current:IntegerTable | undefined;
  constructor(private readonly storage:PagedStorage,private readonly cooperate:(units?:number)=>Promise<void>){}
  async inherited(target:number):Promise<boolean>{return this.current===undefined || await this.current.get(BigInt(target))===1n;}
  clear():void {this.current=new IntegerTable(this.storage,64);}
  copy(): (before:number,after:number)=>Promise<void> {
    const previous=this.current,next=new IntegerTable(this.storage,64);this.current=next;
    return async(before,after)=>{if(previous===undefined || await previous.get(BigInt(before))===1n)await next.set(BigInt(after),1n);};
  }
  private async equal(before:BackedJson,left:number,after:BackedJson,right:number):Promise<boolean> {
    const a=await before.describe(left),b=await after.describe(right);
    if(a.kind!==b.kind || a.end-left!==b.end-right)return false;
    const chunks=after.scalarChunks(right)[Symbol.asyncIterator]();
    try {for await(const text of before.scalarChunks(left)){await this.cooperate(text.length);if(text!==(await chunks.next()).value)return false;}return true;}
    finally{await chunks.return?.(undefined);}
  }
  private async hash(tree:BackedJson,node:number):Promise<bigint> {
    let hash=2166136261;
    for await(const text of tree.scalarChunks(node)) {
      for(let index=0;index<text.length;index++)hash=Math.imul(hash^text.charCodeAt(index),16777619)>>>0;
      await this.cooperate(text.length);
    }
    return BigInt(hash);
  }
  private async property(tree:BackedJson,node:number,name:string):Promise<number | undefined> {
    const end=(await tree.describe(node)).end;
    for(let key=node+32;key<end;){
      await this.cooperate();const value=(await tree.describe(key)).end;
      if(await tree.smallText(key,name.length)===name)return value;
      key=(await tree.describe(value)).end;
    }
    return undefined;
  }
  private async imageTarget(tree:BackedJson,node:number):Promise<number | undefined> {
    const tag=await this.property(tree,node,"t");
    if(tag===undefined || await tree.smallText(tag,5)!=="Image")return undefined;
    const content=(await this.property(tree,node,"c"))!;
    let target=content+32;for(let index=0;index<2;index++)target=(await tree.describe(target)).end;
    return target;
  }
  async transfer(before:BackedJson,after:BackedJson):Promise<void> {
    const next=new IntegerTable(this.storage,64);let top=0;
    const push=async(left:number,right:number)=>{
      await this.cooperate();
      const bytes=new Uint8Array(24),view=new DataView(bytes.buffer);
      [top,left,right].forEach((value,index)=>view.setFloat64(index*8,value,true));top=await this.storage.append(bytes);
    };
    await push(before.rootPosition,after.rootPosition);
    while(top){
      await this.cooperate();
      const bytes=await this.storage.read(top,24),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
      top=view.getFloat64(0,true);const left=view.getFloat64(8,true),right=view.getFloat64(16,true);
      const a=await before.describe(left),b=await after.describe(right);
      if(a.kind!==b.kind)continue;
      if(a.kind==="array") {
        let old=left+32,fresh=right+32;
        while(old<a.end && fresh<b.end){await push(old,fresh);old=(await before.describe(old)).end;fresh=(await after.describe(fresh)).end;}
      } else if(a.kind==="object") {
        const oldTarget=await this.imageTarget(before,left),newTarget=await this.imageTarget(after,right);
        if(oldTarget!==undefined && newTarget!==undefined && await this.inherited(oldTarget+32)) {
          const oldTitle=(await before.describe(oldTarget+32)).end,newTitle=(await after.describe(newTarget+32)).end;
          if(await this.equal(before,oldTarget+32,after,newTarget+32) && await this.equal(before,oldTitle,after,newTitle))await next.set(BigInt(newTarget+32),1n);
        }
        const keys=new IntegerTable(this.storage,64);
        for(let old=left+32;old<a.end;){
          const oldValue=(await before.describe(old)).end,hash=await this.hash(before,old);
          const bytes=new Uint8Array(24),view=new DataView(bytes.buffer);
          [Number(await keys.get(hash)??0n),old,oldValue].forEach((value,index)=>view.setFloat64(index*8,value,true));
          await keys.set(hash,BigInt(await this.storage.append(bytes)));
          old=(await before.describe(oldValue)).end;
        }
        for(let fresh=right+32;fresh<b.end;){
          const value=(await after.describe(fresh)).end;
          let entry=Number(await keys.get(await this.hash(after,fresh))??0n);
          while(entry){
            const bytes=await this.storage.read(entry,24),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
            if(await this.equal(before,view.getFloat64(8,true),after,fresh)){await push(view.getFloat64(16,true),value);break;}
            entry=view.getFloat64(0,true);
          }
          fresh=(await after.describe(value)).end;
        }
      }
    }
    this.current=next;
  }
}
