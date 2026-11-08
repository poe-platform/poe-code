import {PandocError} from "./errors.js";
import type {LuaReference, LuaStorage} from "./lua-storage.js";
import type {LuaProgram} from "./lua-program.js";

const scopeFields={parent:0,base:1,labels:2,pending:3} as const;
const jumpFields={pc:0,active:1,close:2,next:3} as const;

/** Retained label and pending-goto state for one prototype. The compiler supplies
 * the active-local count at each site; a trailing block label uses the block's
 * entry count where Lua permits jumping past local declarations. Loop exits use
 * an internal break label. Inner pending jumps move outward only when their
 * block closes, so a later inner label can shadow an existing outer label. */
export class LuaJumps {
  constructor(private readonly heap: LuaStorage, private readonly program: LuaProgram, private readonly prototype: number) {}

  async enterBlock(base: number, parent?: LuaReference): Promise<LuaReference> {
    const scope=await this.heap.table();
    await this.heap.set(scope,scopeFields.base,base);
    await this.heap.set(scope,scopeFields.parent,parent);
    await this.heap.set(scope,scopeFields.labels,await this.heap.table());
    await this.heap.set(scope,scopeFields.pending,await this.heap.table());
    return scope;
  }
  async patch(pc: number, target: number, closeFrom?: number): Promise<void> {
    const offset=target-pc-1;
    if(!Number.isSafeInteger(offset) || offset < -131071 || offset > 131071)
      throw new PandocError("E_AST","convert","control structure too long");
    if(closeFrom !== undefined && (!Number.isInteger(closeFrom) || closeFrom < 0 || closeFrom >= 255))
      throw new RangeError("Invalid Lua close register");
    const instruction=await this.program.instruction(this.prototype,pc);
    if((instruction.code & 63) !== 30) throw new TypeError("Expected Lua jump instruction");
    await this.program.patch(this.prototype,pc,(30 | (closeFrom === undefined ? 0 : closeFrom+1)<<6 | (offset+131071)<<14)>>>0);
  }
  private async resolve(jump: LuaReference, label: LuaReference): Promise<void> {
    const active=await this.heap.get(jump,jumpFields.active) as number, targetActive=await this.heap.get(label,1) as number;
    if(active < targetActive) throw new PandocError("E_AST","convert","goto jumps into the scope of a local variable");
    let close=await this.heap.get(jump,jumpFields.close) as number | undefined;
    if(active > targetActive) close=Math.min(close ?? targetActive,targetActive);
    await this.patch(await this.heap.get(jump,jumpFields.pc) as number,await this.heap.get(label,0) as number,close);
  }
  private async queue(scope: LuaReference, name: LuaReference, jump: LuaReference): Promise<void> {
    const labels=await this.heap.get(scope,scopeFields.labels) as LuaReference;
    const label=await this.heap.get(labels,name) as LuaReference | undefined;
    if(label) await this.resolve(jump,label);
    else {
      const pending=await this.heap.get(scope,scopeFields.pending) as LuaReference;
      await this.heap.set(jump,jumpFields.next,await this.heap.get(pending,name));
      await this.heap.set(pending,name,jump);
    }
  }
  async go(scope: LuaReference, name: LuaReference, pc: number, active: number): Promise<void> {
    const jump=await this.heap.table();
    await this.heap.set(jump,jumpFields.pc,pc);
    await this.heap.set(jump,jumpFields.active,active);
    await this.queue(scope,name,jump);
  }
  async label(scope: LuaReference, name: LuaReference, pc: number, active: number): Promise<void> {
    const labels=await this.heap.get(scope,scopeFields.labels) as LuaReference;
    if(await this.heap.get(labels,name) !== undefined) throw new PandocError("E_AST","convert","label already defined in this block");
    const label=await this.heap.table();
    await this.heap.set(label,0,pc); await this.heap.set(label,1,active);
    await this.heap.set(labels,name,label);
    const pending=await this.heap.get(scope,scopeFields.pending) as LuaReference;
    let jump=await this.heap.get(pending,name) as LuaReference | undefined;
    while(jump) {
      await this.resolve(jump,label);
      jump=await this.heap.get(jump,jumpFields.next) as LuaReference | undefined;
    }
    await this.heap.set(pending,name,undefined);
  }
  async leaveBlock(scope: LuaReference): Promise<void> {
    const parent=await this.heap.get(scope,scopeFields.parent) as LuaReference | undefined;
    const pending=await this.heap.get(scope,scopeFields.pending) as LuaReference, base=await this.heap.get(scope,scopeFields.base) as number;
    for(let entry=await this.heap.next(pending); entry; entry=await this.heap.next(pending,entry.key)) {
      if(!parent) throw new PandocError("E_AST","convert","no visible label for goto or break outside loop");
      let jump: LuaReference | undefined=entry.value as LuaReference;
      while(jump) {
        const next=await this.heap.get(jump,jumpFields.next) as LuaReference | undefined;
        const active=await this.heap.get(jump,jumpFields.active) as number;
        if(active > base) {
          const close=await this.heap.get(jump,jumpFields.close) as number | undefined;
          await this.heap.set(jump,jumpFields.close,Math.min(close ?? base,base));
          await this.heap.set(jump,jumpFields.active,base);
        }
        await this.queue(parent,entry.key as LuaReference,jump);
        jump=next;
      }
      await this.heap.set(pending,entry.key,undefined);
    }
  }
}
