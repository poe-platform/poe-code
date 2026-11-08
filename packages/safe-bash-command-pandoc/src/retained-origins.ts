import {IntegerTable,type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";

/** Preserve the buffered Lua adapter's structural sharing: an image target keeps
 * its parser origin only when the same-position URL/title tuple is unchanged.
 * Maps and traversal frames live on tape, including arbitrary metadata keys. */
export class RetainedOrigins {
  private current:IntegerTable | undefined;
  constructor(private readonly storage:PagedStorage,private readonly cooperate:(units?:number)=>Promise<void>){}
  async source(target:number):Promise<number>{return this.current===undefined ? 1 : Number(await this.current.get(BigInt(target)) ?? 0n);}
  async inherited(target:number):Promise<boolean>{return await this.source(target)>0;}
  async seed(target:number,source:number):Promise<void>{this.current ??= new IntegerTable(this.storage,64);await this.current.set(BigInt(target),BigInt(source));}
  clear():void {this.current=new IntegerTable(this.storage,64);}
  copy(): (before:number,after:number)=>Promise<void> {
    const previous=this.current,next=new IntegerTable(this.storage,64);this.current=next;
    return async(before,after)=>{const source=previous===undefined ? 1n : await previous.get(BigInt(before)) ?? 0n;if(source)await next.set(BigInt(after),source);};
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
  private async indexKeys(tree: BackedJson, node: number): Promise<IntegerTable> {
    const keys = new IntegerTable(this.storage, 64), end = (await tree.describe(node)).end;
    for (let key = node + 32; key < end;) {
      const value = (await tree.describe(key)).end, hash = await this.hash(tree, key);
      const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
      [Number(await keys.get(hash) ?? 0n), key, value].forEach((item, index) => view.setFloat64(index * 8, item, true));
      await keys.set(hash, BigInt(await this.storage.append(bytes)));
      key = (await tree.describe(value)).end;
    }
    return keys;
  }
  private async lookupKey(tree: BackedJson, keys: IntegerTable, source: BackedJson, key: number): Promise<number | undefined> {
    let entry = Number(await keys.get(await this.hash(source, key)) ?? 0n);
    while (entry) {
      await this.cooperate();
      const bytes = await this.storage.read(entry, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      if (await this.equal(tree, view.getFloat64(8, true), source, key)) return view.getFloat64(16, true);
      entry = view.getFloat64(0, true);
    }
    return undefined;
  }
  /** Typed option replacements have no parser authority, even when their image
   * tuples equal the old values. Only recursively merged MetaMaps retain siblings. */
  private async excludeMetadata(tree: BackedJson, overlay: BackedJson): Promise<void> {
    let top = 0;
    const push = async (map: number, overrides: number) => {
      const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
      [top, map, overrides].forEach((value, index) => view.setFloat64(index * 8, value, true));
      top = await this.storage.append(bytes);
    };
    await push((await tree.property(tree.rootPosition, "meta"))!, overlay.rootPosition);
    while (top) {
      await this.cooperate();
      const bytes = await this.storage.read(top, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      top = view.getFloat64(0, true);
      const map = view.getFloat64(8, true), overrides = view.getFloat64(16, true), keys = await this.indexKeys(tree, map);
      const end = (await overlay.describe(overrides)).end;
      for (let key = overrides + 32; key < end;) {
        const value = (await overlay.describe(key)).end, target = (await this.lookupKey(tree, keys, overlay, key))!;
        const tag = (await overlay.property(value, "t"))!;
        if (await overlay.smallText(tag, 7) === "MetaMap") {
          await push((await tree.property(target, "c"))!, (await overlay.property(value, "c"))!);
        } else {
          const finish = (await tree.describe(target)).end;
          for (let node = target; node < finish;) {
            await this.cooperate();
            const header = await tree.describe(node);
            if (header.kind === "string") await this.current!.set(BigInt(node), 0n);
            node = header.kind === "object" || header.kind === "array" ? node + 32 : header.end;
          }
        }
        key = (await overlay.describe(value)).end;
      }
    }
  }
  async transfer(before:BackedJson,after:BackedJson,metadata?:BackedJson):Promise<void> {
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
          if(await this.equal(before,oldTarget+32,after,newTarget+32) && await this.equal(before,oldTitle,after,newTitle))await next.set(BigInt(newTarget+32),BigInt(await this.source(oldTarget+32)));
        }
        const keys = await this.indexKeys(before, left);
        for (let fresh = right + 32; fresh < b.end;) {
          const value = (await after.describe(fresh)).end;
          const previous = await this.lookupKey(before, keys, after, fresh);
          if (previous !== undefined) await push(previous, value);
          fresh = (await after.describe(value)).end;
        }
      }
    }
    this.current=next;
    if (metadata) await this.excludeMetadata(after, metadata);
  }
}
