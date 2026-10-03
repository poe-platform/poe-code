import {PandocError} from "./errors.js";
import {arithmetic,binaryOpcodes,numeric,type LuaNumber} from "./lua-arithmetic.js";
import type {LuaReference,LuaStorage} from "./lua-storage.js";
import type {LuaSyntax} from "./lua-syntax.js";

/** Lua numeric constant folding with a retained traversal stack and cache.
 * False marks a non-numeral; numeric values include both tagged integers and
 * floats. The existing compiler deliberately does not fold floating zero/NaN
 * results or operations that could raise arithmetic errors. */
export class LuaFolding {
  private cache: Promise<LuaReference> | undefined;
  constructor(private readonly heap: LuaStorage,private readonly syntax: LuaSyntax) {}
  private async push(node: LuaReference,next?: LuaReference): Promise<LuaReference> {
    const task=await this.heap.table();
    await this.heap.set(task,0,node); await this.heap.set(task,1,0); await this.heap.set(task,2,next); return task;
  }
  async value(root: LuaReference): Promise<LuaNumber | undefined> {
    const cache=await (this.cache ??= this.heap.table()), existing=await this.heap.get(cache,root.id);
    if(existing!==undefined) return existing===false?undefined:existing as LuaNumber;
    let task: LuaReference | undefined=await this.push(root);
    while(task) {
      const node=await this.heap.get(task,0) as LuaReference, stage=await this.heap.get(task,1) as number;
      if(await this.heap.get(cache,node.id)!==undefined) {task=await this.heap.get(task,2) as LuaReference | undefined; continue;}
      const {kind}=await this.syntax.describe(node), operator=await this.syntax.operator(node);
      const opcode=kind==="binary" ? binaryOpcodes[operator!] : kind==="unary" ? operator==="-"?25:operator==="~"?26:undefined : undefined;
      let result: LuaNumber | false=false;
      if(kind==="literal") {
        const value=await this.syntax.get(node,"value");
        if(typeof value==="number" || typeof value==="object" && value.kind==="integer") result=value;
      } else if(kind==="parenthesized" || opcode!==undefined) {
        const left=await this.syntax.get(node,kind==="parenthesized"?"value":kind==="unary"?"operand":"left") as LuaReference;
        const right=kind==="binary"?await this.syntax.get(node,"right") as LuaReference:undefined;
        if(stage===0) {await this.heap.set(task,1,1); task=await this.push(left,task); continue;}
        if(stage===1 && right) {await this.heap.set(task,1,2); task=await this.push(right,task); continue;}
        const a=await this.heap.get(cache,left.id) as LuaNumber | false;
        const b=right?await this.heap.get(cache,right.id) as LuaNumber | false:{kind:"integer" as const,value:0};
        if(a!==false && b!==false) {
          if(kind==="parenthesized") result=a;
          else if(!([16,18,19].includes(opcode!) && numeric(b)===0)) {
            try {
              const value=arithmetic(opcode!,a,b);
              if(typeof value!=="number" || !Number.isNaN(value) && value!==0) result=value;
            } catch(error) {if(!(error instanceof PandocError) || error.code!=="E_AST") throw error;}
          }
        }
      }
      await this.heap.set(cache,node.id,result);
      task=await this.heap.get(task,2) as LuaReference | undefined;
    }
    const result=await this.heap.get(cache,root.id);
    return result===false?undefined:result as LuaNumber;
  }
}
