import type {FrameLocals} from "./frame-locals.js";
import {OrderedKeyMap,type KeyOperations} from "./ordered-key-map.js";
import type {ExecutionMeter} from "./execution-budget.js";

export interface FrameLocalsKeyOperations<Key> extends KeyOperations<Key> {
  /** Create the interpreter's exact string key for a compiler-owned slot name. */
  name(name:string):Key;
}

/** One execution-owned mapping per frame, shared by fresh native proxy views.
 * Slot lookup hashes even identity matches, then compares equal-hash names in
 * compiler order. Reads skip unbound slots; writes/deletes still recognize them.
 * Arbitrary extras retain dictionary identity/order separately from local slots.
 * Native descriptors own missing-key diagnostics, bulk operations and views. */
export class FrameLocalsMapping<Key,Value> {
  readonly #names:Array<{readonly name:string;readonly key:Key}>=[];
  readonly #keys:KeyOperations<Key>;
  #extra:OrderedKeyMap<Key,Value>|undefined;
  constructor(private readonly slots:FrameLocals<Value>,operations:FrameLocalsKeyOperations<Key>,private readonly meter:ExecutionMeter){
    meter.checkpoint(1,192);
    this.#keys={hash(key){try{return operations.hash(key);}finally{meter.checkpoint();}},equal(left,right){try{return operations.equal(left,right);}finally{meter.checkpoint();}}};
    for(const name of slots.names){
      meter.checkpoint(1,48);let key:Key;
      try{key=operations.name(name);}finally{meter.checkpoint();}
      this.#names.push({name,key});
    }
    Object.freeze(this);
  }
  #find(key:Key,read:boolean):{readonly name:string;readonly value?:{readonly value:Value}}|undefined {
    this.meter.checkpoint();const hash=this.#keys.hash(key);
    for(const slot of this.#names){
      this.meter.checkpoint();if(slot.key!==key)continue;
      const value=read?this.slots.lookup(slot.name):undefined;
      if(read&&value===undefined)return undefined;
      this.meter.checkpoint(0,32);return {name:slot.name,value};
    }
    for(const slot of this.#names){
      this.meter.checkpoint();
      if(this.#keys.hash(slot.key)!==hash||!this.#keys.equal(slot.key,key))continue;
      const value=read?this.slots.lookup(slot.name):undefined;
      if(read&&value===undefined)continue;
      this.meter.checkpoint(0,32);return {name:slot.name,value};
    }
    return undefined;
  }
  lookup(key:Key):{readonly value:Value}|undefined {
    const slot=this.#find(key,true);
    return slot===undefined?this.#extra?.lookup(key):slot.value;
  }
  set(key:Key,value:Value):void {
    const slot=this.#find(key,false);
    if(slot!==undefined){this.slots.store(slot.name,value);return;}
    this.#extra??=new OrderedKeyMap(this.#keys,this.meter);
    this.#extra.set(key,value);
  }
  delete(key:Key):boolean {
    const slot=this.#find(key,false);
    if(slot!==undefined)return this.slots.delete(slot.name);
    return this.#extra?.delete(key)??false;
  }
  pop(key:Key):{readonly value:Value}|undefined {
    const slot=this.#find(key,false);
    if(slot!==undefined){this.slots.delete(slot.name);return undefined;}
    return this.#extra?.pop(key);
  }
  get size():number {
    this.meter.checkpoint();let size=this.#extra?.size??0;
    for(const slot of this.#names){if(this.slots.lookup(slot.name)!==undefined)size++;}
    return size;
  }
  entries():Array<readonly [Key,Value]> {
    this.meter.checkpoint(1,64);const entries:Array<readonly [Key,Value]>=[];
    for(const slot of this.#names){
      const value=this.slots.lookup(slot.name);if(value===undefined)continue;
      this.meter.checkpoint(0,32);entries.push([slot.key,value.value]);
    }
    if(this.#extra!==undefined){
      this.meter.checkpoint(0,64);const iterator=this.#extra.iterate((key,value)=>{this.meter.checkpoint(0,32);return [key,value] as const;});
      while(true){const next=iterator.next();if(next.done)break;this.meter.checkpoint(0,8);entries.push(next.value);}
    }
    return entries;
  }
}
