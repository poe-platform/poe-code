import {PandocError} from "./errors.js";
import type {LuaReference, LuaStorage} from "./lua-storage.js";
import type {LuaProgram} from "./lua-program.js";

export interface LuaBinding {
  register: boolean;
  index: number;
  declaration: LuaReference;
}
// Scope records, declaration records and pending capture links have separate
// fixed layouts. Declaration chains are immutable so a child function retains
// the lexical environment at its definition, including same-block shadowing.
const scopeFields = {parent:0,owner:1,names:2,base:3,close:4,prototype:5,active:6,captures:7,outer:8,version:9} as const;
const declarationFields = {index:0,register:1,scope:2,next:3,version:4} as const;

/** Lexical compiler state in caller storage. This allocates active local slots
 * and prototype capture descriptors, not expression temporaries or bytecode.
 * Children snapshot per-scope declaration versions without copying names or values.
 * Backed name indexes avoid scanning unrelated declarations on each lookup.
 * Capturing through ancestors uses backed links rather than JS recursion. */
export class LuaBindings {
  constructor(private readonly heap: LuaStorage, private readonly program: LuaProgram) {}

  private async snapshot(scope: LuaReference): Promise<LuaReference> {
    let current: LuaReference | undefined=scope, first: LuaReference | undefined, previous: LuaReference | undefined;
    while(current) {
      const copy=await this.heap.table();
      for(const field of [scopeFields.owner,scopeFields.names,scopeFields.version]) await this.heap.set(copy,field,await this.heap.get(current,field));
      if(previous) await this.heap.set(previous,scopeFields.parent,copy);
      else first=copy;
      previous=copy;
      current=await this.heap.get(current,scopeFields.parent) as LuaReference | undefined;
    }
    return first!;
  }
  async enterFunction(prototype: number, outer?: LuaReference): Promise<LuaReference> {
    const root=await this.heap.table();
    await this.heap.set(root,scopeFields.owner,root);
    await this.heap.set(root,scopeFields.prototype,prototype);
    await this.heap.set(root,scopeFields.active,0);
    await this.heap.set(root,scopeFields.base,0);
    await this.heap.set(root,scopeFields.names,await this.heap.table());
    await this.heap.set(root,scopeFields.version,0);
    await this.heap.set(root,scopeFields.captures,await this.heap.table());
    if(outer) await this.heap.set(root,scopeFields.outer,await this.snapshot(outer));
    else {
      const environment=await this.heap.string([new TextEncoder().encode("_ENV")]);
      const index=await this.program.addCapture(prototype,{register:true,index:0});
      await this.declaration(root,environment,index,false);
    }
    return root;
  }
  async enterBlock(parent: LuaReference): Promise<LuaReference> {
    const scope=await this.heap.table(), owner=await this.heap.get(parent,scopeFields.owner) as LuaReference;
    await this.heap.set(scope,scopeFields.owner,owner);
    await this.heap.set(scope,scopeFields.parent,parent);
    await this.heap.set(scope,scopeFields.names,await this.heap.table());
    await this.heap.set(scope,scopeFields.version,0);
    await this.heap.set(scope,scopeFields.base,await this.heap.get(owner,scopeFields.active));
    return scope;
  }
  async active(scope: LuaReference): Promise<number> {
    const owner=await this.heap.get(scope,scopeFields.owner) as LuaReference;
    return await this.heap.get(owner,scopeFields.active) as number;
  }
  private async declaration(scope: LuaReference, name: LuaReference, index: number, register: boolean): Promise<LuaBinding> {
    if(name.kind !== "string") throw new TypeError("Expected Lua identifier");
    const declaration=await this.heap.table(), names=await this.heap.get(scope,scopeFields.names) as LuaReference;
    const version=(await this.heap.get(scope,scopeFields.version) as number)+1;
    await this.heap.set(declaration,declarationFields.index,index);
    await this.heap.set(declaration,declarationFields.register,register);
    await this.heap.set(declaration,declarationFields.scope,scope);
    await this.heap.set(declaration,declarationFields.next,await this.heap.get(names,name));
    await this.heap.set(declaration,declarationFields.version,version);
    await this.heap.set(names,name,declaration);
    await this.heap.set(scope,scopeFields.version,version);
    return {register,index,declaration};
  }
  async declare(scope: LuaReference, name: LuaReference): Promise<LuaBinding> {
    const owner=await this.heap.get(scope,scopeFields.owner) as LuaReference, index=await this.active(scope);
    if(index >= 200) throw new PandocError("E_AST","convert","too many local variables (limit is 200)");
    const binding=await this.declaration(scope,name,index,true);
    await this.heap.set(owner,scopeFields.active,index+1);
    return binding;
  }
  async leaveBlock(scope: LuaReference): Promise<{parent: LuaReference; closeFrom: number | undefined}> {
    const parent=await this.heap.get(scope,scopeFields.parent) as LuaReference | undefined;
    if(!parent) throw new TypeError("Cannot leave a function as a lexical block");
    const owner=await this.heap.get(scope,scopeFields.owner) as LuaReference;
    await this.heap.set(owner,scopeFields.active,await this.heap.get(scope,scopeFields.base));
    return {parent,closeFrom:await this.heap.get(scope,scopeFields.close) as number | undefined};
  }
  async resolve(scope: LuaReference, name: LuaReference): Promise<LuaBinding | undefined> {
    let current: LuaReference | undefined=scope, pending: LuaReference | undefined;
    let binding: LuaBinding | undefined;
    while(current) {
      const names=await this.heap.get(current,scopeFields.names) as LuaReference;
      const version=await this.heap.get(current,scopeFields.version) as number;
      let declaration=await this.heap.get(names,name) as LuaReference | undefined;
      while(declaration) {
        if((await this.heap.get(declaration,declarationFields.version) as number) <= version) {
          binding={declaration,index:await this.heap.get(declaration,declarationFields.index) as number,
            register:await this.heap.get(declaration,declarationFields.register) as boolean};
          break;
        }
        declaration=await this.heap.get(declaration,declarationFields.next) as LuaReference | undefined;
      }
      if(binding) break;
      const parent=await this.heap.get(current,scopeFields.parent) as LuaReference | undefined;
      if(parent) current=parent;
      else {
        const owner=await this.heap.get(current,scopeFields.owner) as LuaReference;
        current=await this.heap.get(owner,scopeFields.outer) as LuaReference | undefined;
        if(current) {
          const link=await this.heap.table();
          await this.heap.set(link,0,owner); await this.heap.set(link,1,pending); pending=link;
        }
      }
    }
    if(!binding) return undefined;
    if(pending && binding.register) {
      const declaredIn=await this.heap.get(binding.declaration,declarationFields.scope) as LuaReference;
      const close=await this.heap.get(declaredIn,scopeFields.close) as number | undefined;
      await this.heap.set(declaredIn,scopeFields.close,Math.min(close ?? binding.index,binding.index));
    }
    while(pending) {
      const owner=await this.heap.get(pending,0) as LuaReference;
      const captures=await this.heap.get(owner,scopeFields.captures) as LuaReference;
      let index=await this.heap.get(captures,binding.declaration.id) as number | undefined;
      if(index === undefined) {
        const prototype=await this.heap.get(owner,scopeFields.prototype) as number;
        if((await this.program.describe(prototype)).captures >= 255)
          throw new PandocError("E_AST","convert","too many upvalues (limit is 255)");
        index=await this.program.addCapture(prototype,{register:binding.register,index:binding.index});
        await this.heap.set(captures,binding.declaration.id,index);
      }
      binding={declaration:binding.declaration,register:false,index};
      pending=await this.heap.get(pending,1) as LuaReference | undefined;
    }
    return binding;
  }
}
