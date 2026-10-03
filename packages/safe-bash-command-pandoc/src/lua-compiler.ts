import {binaryOpcodes} from "./lua-arithmetic.js";
import {LuaFolding} from "./lua-folding.js";
import {PandocError} from "./errors.js";
import {LuaBindings,type LuaBinding} from "./lua-bindings.js";
import {LuaJumps} from "./lua-jumps.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";
import type {LuaProgram} from "./lua-program.js";
import type {LuaSyntax} from "./lua-syntax.js";

interface FunctionState {
  prototype: number; scope: LuaReference; jumpScope: LuaReference; jumps: LuaJumps;
  constants: LuaReference; integers: LuaReference; nilConstant?: number;
  registers: number; vararg: boolean;
}
const taskFields={node:0,target:1,wanted:2,stage:3,next:4,left:5,right:6,index:7,pending:8,block:9,open:10,jump:11} as const;
const multiKinds=new Set(["call","methodcall","vararg"]);

/** Source compiler over retained syntax, bindings, prototypes and continuations.
 * Statement/function recursion follows the parser's existing syntax-depth bound;
 * unbounded expression chains use linked caller-backed continuation records.
 * This remains private until the complete library and Pandoc bridge are wired. */
export class LuaCompiler {
  private readonly bindings: LuaBindings;
  private readonly folding: LuaFolding;
  private environment: Promise<LuaReference> | undefined;
  private breakName: Promise<LuaReference> | undefined;
  constructor(private readonly heap: LuaStorage,private readonly program: LuaProgram,private readonly syntax: LuaSyntax) {
    this.bindings=new LuaBindings(heap,program);
    this.folding=new LuaFolding(heap,syntax);
  }
  private fail(message: string): never {throw new PandocError("E_AST","convert",message);}
  private reserve(ctx: FunctionState,end: number): void {
    if(end>=255) this.fail("function or expression needs too many registers");
    ctx.registers=Math.max(ctx.registers,end);
  }
  private async abc(ctx: FunctionState,op: number,a: number,b: number,c: number,line: number): Promise<number> {
    if(a<0 || a>255 || b<0 || b>511 || c<0 || c>511) this.fail("instruction operand out of range");
    return this.program.emit(ctx.prototype,(op | a<<6 | c<<14 | b<<23)>>>0,line);
  }
  private async bx(ctx: FunctionState,op: number,a: number,b: number,line: number): Promise<number> {
    if(a<0 || a>255 || b<0 || b>262143) this.fail("instruction operand out of range");
    return this.program.emit(ctx.prototype,(op | a<<6 | b<<14)>>>0,line);
  }
  private async pc(ctx: FunctionState): Promise<number> {return (await this.program.describe(ctx.prototype)).instructions;}
  private async constant(ctx: FunctionState,value: StoredLuaValue): Promise<number> {
    if(value===undefined) {
      if(ctx.nilConstant===undefined) ctx.nilConstant=await this.program.addConstant(ctx.prototype,value);
      return ctx.nilConstant;
    }
    const map=typeof value==="object" && value.kind==="integer" ? ctx.integers : ctx.constants;
    let index=await this.heap.get(map,value) as number | undefined;
    if(index===undefined) {index=await this.program.addConstant(ctx.prototype,value); await this.heap.set(map,value,index);}
    return index;
  }
  private async load(ctx: FunctionState,target: number,index: number,line: number): Promise<void> {
    this.reserve(ctx,target+1);
    if(index>67108863) this.fail("too many constants");
    if(index<=262143) await this.bx(ctx,1,target,index,line);
    else {await this.bx(ctx,2,target,0,line); await this.program.emit(ctx.prototype,(46 | index<<6)>>>0,line);}
  }
  private async key(ctx: FunctionState,value: StoredLuaValue,temp: number,line: number): Promise<number> {
    const index=await this.constant(ctx,value);
    if(index<=255) return 256+index;
    await this.load(ctx,temp,index,line); return temp;
  }
  private async direct(ctx: FunctionState,node: LuaReference): Promise<number | undefined> {
    const folded=await this.folding.value(node);
    if(folded!==undefined) {const index=await this.constant(ctx,folded); return index<=255?256+index:undefined;}
    const {kind}=await this.syntax.describe(node);
    if(kind==="literal") {const index=await this.constant(ctx,await this.syntax.get(node,"value")); return index<=255 ? 256+index : undefined;}
    if(kind==="name") {
      const binding=await this.bindings.resolve(ctx.scope,await this.syntax.get(node,"name") as LuaReference);
      if(binding?.register) return binding.index;
    }
    return undefined;
  }
  private async env(ctx: FunctionState): Promise<LuaBinding> {
    const name=await (this.environment ??= this.heap.string([new TextEncoder().encode("_ENV")]));
    const binding=await this.bindings.resolve(ctx.scope,name);
    if(!binding) this.fail("missing lexical environment");
    return binding;
  }
  private async push(node: LuaReference,target: number,wanted: number,next?: LuaReference): Promise<LuaReference> {
    const task=await this.heap.table();
    await this.heap.set(task,taskFields.node,node); await this.heap.set(task,taskFields.target,target);
    await this.heap.set(task,taskFields.wanted,wanted); await this.heap.set(task,taskFields.stage,0);
    await this.heap.set(task,taskFields.next,next); return task;
  }
  private async expression(ctx: FunctionState,root: LuaReference,target: number,wanted=1): Promise<void> {
    let task: LuaReference | undefined=await this.push(root,target,wanted);
    while(task) {
      const node=await this.heap.get(task,taskFields.node) as LuaReference;
      const target=await this.heap.get(task,taskFields.target) as number, wanted=await this.heap.get(task,taskFields.wanted) as number;
      const stage=await this.heap.get(task,taskFields.stage) as number, {kind,line}=await this.syntax.describe(node);
      this.reserve(ctx,target+Math.max(1,wanted));
      const folded=stage===0?await this.folding.value(node):undefined;
      if(folded!==undefined) {
        await this.load(ctx,target,await this.constant(ctx,folded),line);
        if(wanted>1) await this.abc(ctx,4,target+1,wanted-2,0,line);
        task=await this.heap.get(task,taskFields.next) as LuaReference | undefined; continue;
      }
      let complete=true, pad=true;
      switch(kind) {
        case "literal": {
          const value=await this.syntax.get(node,"value");
          if(value===undefined) await this.abc(ctx,4,target,0,0,line);
          else if(typeof value==="boolean") await this.abc(ctx,3,target,Number(value),0,line);
          else await this.load(ctx,target,await this.constant(ctx,value),line);
          break;
        }
        case "name": {
          const name=await this.syntax.get(node,"name") as LuaReference, binding=await this.bindings.resolve(ctx.scope,name);
          if(binding) {if(!binding.register || binding.index!==target) await this.abc(ctx,binding.register?0:5,target,binding.index,0,line);}
          else {const env=await this.env(ctx); await this.abc(ctx,env.register?7:6,target,env.index,await this.key(ctx,name,target+1,line),line);}
          break;
        }
        case "vararg":
          if(!ctx.vararg) this.fail("cannot use '...' outside a vararg function");
          await this.abc(ctx,45,target,wanted<0?0:wanted+1,0,line); pad=false; break;
        case "parenthesized": case "unary": {
          if(stage===0) {
            await this.heap.set(task,taskFields.stage,1);
            task=await this.push(await this.syntax.get(node,kind==="unary"?"operand":"value") as LuaReference,target,1,task); complete=false;
          } else if(kind==="unary") {
            const op=await this.syntax.operator(node);
            await this.abc(ctx,op==="-"?25:op==="~"?26:op==="not"?27:28,target,target,0,line);
          }
          break;
        }
        case "binary": {
          const op=(await this.syntax.operator(node))!;
          if(op==="and" || op==="or") {
            if(stage===0) {
              await this.heap.set(task,taskFields.stage,1);
              task=await this.push(await this.syntax.get(node,"left") as LuaReference,target,1,task); complete=false;
            } else if(stage===1) {
              await this.abc(ctx,34,target,0,op==="or"?1:0,line);
              await this.heap.set(task,taskFields.jump,await this.bx(ctx,30,0,131071,line));
              await this.heap.set(task,taskFields.stage,2);
              task=await this.push(await this.syntax.get(node,"right") as LuaReference,target,1,task); complete=false;
            } else await ctx.jumps.patch(await this.heap.get(task,taskFields.jump) as number,await this.pc(ctx));
            break;
          }
          if(stage===0) {
            const left=await this.syntax.get(node,"left") as LuaReference, direct=op===".."?undefined:await this.direct(ctx,left);
            await this.heap.set(task,taskFields.left,direct ?? target); await this.heap.set(task,taskFields.stage,1);
            if(direct===undefined) task=await this.push(left,target,1,task);
            complete=false;
          } else if(stage===1) {
            const left=await this.heap.get(task,taskFields.left) as number;
            const right=await this.syntax.get(node,"right") as LuaReference, temp=left===target?target+1:target;
            const direct=op===".."?undefined:await this.direct(ctx,right);
            await this.heap.set(task,taskFields.right,direct ?? temp); await this.heap.set(task,taskFields.stage,2);
            if(direct===undefined) task=await this.push(right,temp,1,task);
            complete=false;
          } else {
            let left=await this.heap.get(task,taskFields.left) as number, right=await this.heap.get(task,taskFields.right) as number;
            if(op==="..") await this.abc(ctx,29,target,left,right,line);
            else if(binaryOpcodes[op]!==undefined) await this.abc(ctx,binaryOpcodes[op]!,target,left,right,line);
            else {
              if(op===">" || op===">=") [left,right]=[right,left];
              await this.abc(ctx,op==="==" || op==="~="?31:op==="<" || op===">"?32:33,op==="~="?0:1,left,right,line);
              await this.bx(ctx,30,0,131072,line);
              await this.abc(ctx,3,target,0,1,line); await this.abc(ctx,3,target,1,0,line);
            }
          }
          break;
        }
        case "index": {
          if(stage===0) {
            const base=await this.syntax.get(node,"base") as LuaReference;
            const binding=(await this.syntax.describe(base)).kind==="name" ? await this.bindings.resolve(ctx.scope,await this.syntax.get(base,"name") as LuaReference) : undefined;
            await this.heap.set(task,taskFields.left,binding?.index ?? target); await this.heap.set(task,taskFields.open,binding ? !binding.register : false);
            await this.heap.set(task,taskFields.stage,1);
            if(!binding) task=await this.push(base,target,1,task);
            complete=false;
          } else if(stage===1) {
            const key=await this.syntax.get(node,"key") as LuaReference, direct=await this.direct(ctx,key);
            const temp=!(await this.heap.get(task,taskFields.open)) && (await this.heap.get(task,taskFields.left))===target?target+1:target;
            await this.heap.set(task,taskFields.right,direct ?? temp); await this.heap.set(task,taskFields.stage,2);
            if(direct===undefined) task=await this.push(key,temp,1,task);
            complete=false;
          } else await this.abc(ctx,await this.heap.get(task,taskFields.open)?6:7,target,await this.heap.get(task,taskFields.left) as number,await this.heap.get(task,taskFields.right) as number,line);
          break;
        }
        case "call": case "methodcall": {
          const method=kind==="methodcall", args=await this.syntax.get(node,"arguments") as LuaReference, count=await this.syntax.length(args), offset=method?2:1;
          if(stage===0) {
            await this.heap.set(task,taskFields.stage,1);
            task=await this.push(await this.syntax.get(node,"callee") as LuaReference,target,1,task); complete=false;
          } else if(stage===1) {
            if(method) {this.reserve(ctx,target+2); await this.abc(ctx,12,target,target,await this.key(ctx,await this.syntax.get(node,"method"),target+2,line),line);}
            await this.heap.set(task,taskFields.index,0); await this.heap.set(task,taskFields.stage,2); complete=false;
          } else {
            const index=await this.heap.get(task,taskFields.index) as number;
            if(index<count) {
              const arg=await this.syntax.at(args,index) as LuaReference, open=index===count-1 && multiKinds.has((await this.syntax.describe(arg)).kind);
              await this.heap.set(task,taskFields.index,index+1); await this.heap.set(task,taskFields.open,open);
              task=await this.push(arg,target+offset+index,open?-1:1,task); complete=false;
            } else {await this.abc(ctx,36,target,await this.heap.get(task,taskFields.open)?0:count+offset,wanted<0?0:wanted+1,line); pad=false;}
          }
          break;
        }
        case "table": {
          const fields=await this.syntax.get(node,"fields") as LuaReference, count=await this.syntax.length(fields);
          if(stage===0) {
            await this.abc(ctx,11,target,0,0,line);
            await this.heap.set(task,taskFields.index,0); await this.heap.set(task,taskFields.pending,0); await this.heap.set(task,taskFields.block,1);
            await this.heap.set(task,taskFields.stage,1); complete=false;
          } else if(stage===1) {
            const index=await this.heap.get(task,taskFields.index) as number, pending=await this.heap.get(task,taskFields.pending) as number;
            if(index===count) {
              if(pending) await this.setList(ctx,target,pending,await this.heap.get(task,taskFields.block) as number,line);
            } else {
              const field=await this.syntax.at(fields,index) as LuaReference, key=await this.syntax.get(field,"key") as LuaReference | undefined;
              await this.heap.set(task,taskFields.index,index+1);
              if(key) {
                const direct=await this.direct(ctx,key);
                await this.heap.set(task,taskFields.left,direct ?? target+pending+1); await this.heap.set(task,taskFields.stage,3);
                if(direct===undefined) task=await this.push(key,target+pending+1,1,task);
              } else {
                const value=await this.syntax.get(field,"value") as LuaReference, open=index===count-1 && multiKinds.has((await this.syntax.describe(value)).kind);
                await this.heap.set(task,taskFields.open,open); await this.heap.set(task,taskFields.stage,2);
                task=await this.push(value,target+pending+1,open?-1:1,task);
              }
              complete=false;
            }
          } else if(stage===2) {
            let pending=(await this.heap.get(task,taskFields.pending) as number)+1;
            const index=await this.heap.get(task,taskFields.index) as number, block=await this.heap.get(task,taskFields.block) as number;
            if(pending===50 || index===count) {
              await this.setList(ctx,target,await this.heap.get(task,taskFields.open)?0:pending,block,line);
              pending=0; await this.heap.set(task,taskFields.block,block+1);
            }
            await this.heap.set(task,taskFields.pending,pending); await this.heap.set(task,taskFields.stage,1); complete=false;
          } else if(stage===3) {
            const field=await this.syntax.at(fields,(await this.heap.get(task,taskFields.index) as number)-1) as LuaReference;
            const temp=target+(await this.heap.get(task,taskFields.pending) as number)+2;
            await this.heap.set(task,taskFields.stage,4);
            task=await this.push(await this.syntax.get(field,"value") as LuaReference,temp,1,task); complete=false;
          } else {
            await this.abc(ctx,10,target,await this.heap.get(task,taskFields.left) as number,target+(await this.heap.get(task,taskFields.pending) as number)+2,line);
            await this.heap.set(task,taskFields.stage,1); complete=false;
          }
          break;
        }
        case "function": {
          const child=await this.functionBody(await this.syntax.get(node,"body") as LuaReference,node,ctx.scope);
          await this.bx(ctx,44,target,await this.program.addChild(ctx.prototype,child),line); break;
        }
        default: this.fail(`invalid expression node ${kind}`);
      }
      if(complete) {
        if(pad && wanted>1) await this.abc(ctx,4,target+1,wanted-2,0,line);
        task=await this.heap.get(task!,taskFields.next) as LuaReference | undefined;
      }
    }
  }
  private async setList(ctx: FunctionState,target: number,count: number,block: number,line: number): Promise<void> {
    await this.abc(ctx,43,target,count,block<=511?block:0,line);
    if(block>511) await this.program.emit(ctx.prototype,(46 | block<<6)>>>0,line);
  }
  private async values(ctx: FunctionState,list: LuaReference,target: number,wanted: number): Promise<boolean> {
    const count=await this.syntax.length(list);
    if(count===0 && wanted>0) {this.reserve(ctx,target+wanted); await this.abc(ctx,4,target,wanted-1,0,(await this.syntax.describe(list)).line);}
    let open=false;
    for(let i=0;i<count;i++) {
      const value=await this.syntax.at(list,i) as LuaReference;
      open=i===count-1 && wanted<0 && multiKinds.has((await this.syntax.describe(value)).kind);
      await this.expression(ctx,value,target+i,i===count-1 ? wanted<0 ? open?-1:1 : Math.max(0,wanted-i) : 1);
    }
    return open;
  }
  private async enter(ctx: FunctionState): Promise<LuaReference> {
    const parent=ctx.jumpScope, base=await this.bindings.active(ctx.scope);
    ctx.scope=await this.bindings.enterBlock(ctx.scope); ctx.jumpScope=await ctx.jumps.enterBlock(base,parent); return parent;
  }
  private async leave(ctx: FunctionState,parent: LuaReference,line: number,emit=true): Promise<number | undefined> {
    const {parent:scope,closeFrom}=await this.bindings.leaveBlock(ctx.scope);
    await ctx.jumps.leaveBlock(ctx.jumpScope); ctx.scope=scope; ctx.jumpScope=parent;
    if(emit && closeFrom!==undefined) await this.bx(ctx,30,closeFrom+1,131071,line);
    return closeFrom;
  }
  private async block(ctx: FunctionState,body: LuaReference,scoped=true,trailing=true): Promise<void> {
    const parent=scoped?await this.enter(ctx):undefined, count=await this.syntax.length(body), base=await this.bindings.active(ctx.scope);
    let last=count;
    if(trailing) while(last>0 && (await this.syntax.describe(await this.syntax.at(body,last-1) as LuaReference)).kind==="label") last--;
    for(let i=0;i<count;i++) await this.statement(ctx,await this.syntax.at(body,i) as LuaReference,i>=last?base:undefined);
    if(parent) await this.leave(ctx,parent,(await this.syntax.describe(body)).line);
  }
  private async store(ctx: FunctionState,node: LuaReference): Promise<void> {
    const {kind,line}=await this.syntax.describe(node), variables=kind==="functionstatement"?undefined:await this.syntax.get(node,"variables") as LuaReference;
    const count=variables?await this.syntax.length(variables):1, targets=await this.heap.table();
    let temp=await this.bindings.active(ctx.scope);
    for(let i=0;i<count;i++) {
      const target=variables?await this.syntax.at(variables,i) as LuaReference:await this.syntax.get(node,"value") as LuaReference;
      const descriptor=await this.heap.table(), targetKind=(await this.syntax.describe(target)).kind;
      let variable: LuaBinding | undefined;
      if(targetKind==="name") {
        const name=await this.syntax.get(target,"name") as LuaReference;
        variable=await this.bindings.resolve(ctx.scope,name);
        if(variable) {await this.heap.set(descriptor,0,variable.register?0:1); await this.heap.set(descriptor,1,variable.index);}
        else {
          const env=await this.env(ctx); await this.heap.set(descriptor,0,env.register?2:3); await this.heap.set(descriptor,2,env.index);
          const key=await this.key(ctx,name,temp,line); if(key===temp) temp++;
          await this.heap.set(descriptor,3,key);
        }
      } else {
        const base=await this.syntax.get(target,"base") as LuaReference;
        const binding=(await this.syntax.describe(base)).kind==="name" ? await this.bindings.resolve(ctx.scope,await this.syntax.get(base,"name") as LuaReference) : undefined;
        await this.heap.set(descriptor,0,binding && !binding.register?3:2);
        let baseRegister=binding?.index;
        if(baseRegister===undefined) {baseRegister=temp++; await this.expression(ctx,base,baseRegister);}
        await this.heap.set(descriptor,2,baseRegister);
        const key=await this.syntax.get(target,"key") as LuaReference;
        let keyOperand=await this.direct(ctx,key);
        if(keyOperand===undefined) {keyOperand=temp++; await this.expression(ctx,key,keyOperand);}
        await this.heap.set(descriptor,3,keyOperand);
      }
      if(variable) for(let j=0;j<i;j++) {
        const earlier=await this.heap.get(targets,j) as LuaReference, earlierKind=await this.heap.get(earlier,0) as number;
        if(earlierKind<2) continue;
        const base=await this.heap.get(earlier,2) as number, key=await this.heap.get(earlier,3) as number;
        const baseConflict=base===variable.index && (earlierKind===2)===variable.register;
        const keyConflict=earlierKind===2 && variable.register && key===variable.index;
        if(baseConflict || keyConflict) {
          this.reserve(ctx,temp+1); await this.abc(ctx,variable.register?0:5,temp,variable.index,0,line);
          if(baseConflict) {await this.heap.set(earlier,0,2); await this.heap.set(earlier,2,temp);}
          if(keyConflict) await this.heap.set(earlier,3,temp);
          temp++;
        }
      }
      await this.heap.set(targets,i,descriptor);
    }
    if(kind==="functionstatement") await this.expression(ctx,await this.syntax.get(node,"body") as LuaReference,temp);
    else await this.values(ctx,await this.syntax.get(node,"values") as LuaReference,temp,count);
    for(let i=count-1;i>=0;i--) {
      const descriptor=await this.heap.get(targets,i) as LuaReference, type=await this.heap.get(descriptor,0) as number;
      if(type===0) await this.abc(ctx,0,await this.heap.get(descriptor,1) as number,temp+i,0,line);
      else if(type===1) await this.abc(ctx,9,temp+i,await this.heap.get(descriptor,1) as number,0,line);
      else await this.abc(ctx,type===2?10:8,await this.heap.get(descriptor,2) as number,await this.heap.get(descriptor,3) as number,temp+i,line);
    }
  }
  private async branch(ctx: FunctionState,condition: LuaReference): Promise<number> {
    const target=await this.bindings.active(ctx.scope), line=(await this.syntax.describe(condition)).line;
    await this.expression(ctx,condition,target); await this.abc(ctx,34,target,0,0,line); return this.bx(ctx,30,0,131071,line);
  }
  private async loopJump(ctx: FunctionState,pc: number,target: number,op: number,a: number): Promise<void> {
    const offset=target-pc-1;
    if(Math.abs(offset)>131071) this.fail("control structure too long");
    await this.program.patch(ctx.prototype,pc,(op | a<<6 | (offset+131071)<<14)>>>0);
  }
  private async statement(ctx: FunctionState,node: LuaReference,labelActive?: number): Promise<void> {
    const {kind,line}=await this.syntax.describe(node), active=await this.bindings.active(ctx.scope);
    switch(kind) {
      case "local": {
        const variables=await this.syntax.get(node,"variables") as LuaReference, count=await this.syntax.length(variables);
        await this.values(ctx,await this.syntax.get(node,"values") as LuaReference,active,count);
        for(let i=0;i<count;i++) await this.bindings.declare(ctx.scope,await this.syntax.get(await this.syntax.at(variables,i) as LuaReference,"name") as LuaReference);
        break;
      }
      case "localfunction": {
        const name=await this.syntax.get(await this.syntax.get(node,"name") as LuaReference,"name") as LuaReference;
        const binding=await this.bindings.declare(ctx.scope,name);
        await this.expression(ctx,await this.syntax.get(node,"body") as LuaReference,binding.index); break;
      }
      case "assign": case "functionstatement": await this.store(ctx,node); break;
      case "call": case "methodcall": await this.expression(ctx,node,active,0); break;
      case "return": {
        const values=await this.syntax.get(node,"values") as LuaReference, count=await this.syntax.length(values);
        const open=await this.values(ctx,values,active,-1);
        if(count===1 && open && (await this.syntax.describe(await this.syntax.at(values,0) as LuaReference)).kind!=="vararg") {
          const pc=(await this.pc(ctx))-1, instruction=await this.program.instruction(ctx.prototype,pc);
          await this.program.patch(ctx.prototype,pc,(instruction.code & ~63) | 37);
        }
        await this.abc(ctx,38,active,open?0:count+1,0,line); break;
      }
      case "do": await this.block(ctx,await this.syntax.get(node,"body") as LuaReference); break;
      case "if": {
        const clauses=await this.syntax.get(node,"clauses") as LuaReference, count=await this.syntax.length(clauses), ends=await this.heap.table();
        for(let i=0;i<count;i++) {
          const clause=await this.syntax.at(clauses,i) as LuaReference, condition=await this.syntax.get(clause,"condition") as LuaReference | undefined;
          const skip=condition?await this.branch(ctx,condition):undefined;
          await this.block(ctx,await this.syntax.get(clause,"body") as LuaReference);
          if(i<count-1) await this.heap.set(ends,i,await this.bx(ctx,30,0,131071,line));
          if(skip!==undefined) await ctx.jumps.patch(skip,await this.pc(ctx));
        }
        const end=await this.pc(ctx);
        for(let i=0;i<count-1;i++) await ctx.jumps.patch(await this.heap.get(ends,i) as number,end);
        break;
      }
      case "while": case "repeat": {
        const parent=await this.enter(ctx), start=await this.pc(ctx), condition=await this.syntax.get(node,"condition") as LuaReference;
        if(kind==="while") {
          const skip=await this.branch(ctx,condition);
          await this.block(ctx,await this.syntax.get(node,"body") as LuaReference);
          const back=await this.bx(ctx,30,0,131071,line); await ctx.jumps.patch(back,start);
          await ctx.jumps.patch(skip,await this.pc(ctx));
        } else {
          const bodyParent=await this.enter(ctx);
          await this.block(ctx,await this.syntax.get(node,"body") as LuaReference,false,false);
          const back=await this.branch(ctx,condition), close=await this.leave(ctx,bodyParent,line,false);
          await ctx.jumps.patch(back,start,close);
          if(close!==undefined) await this.bx(ctx,30,close+1,131071,line);
        }
        await ctx.jumps.label(ctx.jumpScope,await (this.breakName ??= this.heap.string([new TextEncoder().encode("break")])),await this.pc(ctx),active);
        await this.leave(ctx,parent,line); break;
      }
      case "fornumber": case "forin": {
        const parent=await this.enter(ctx), variables=await this.syntax.get(node,"variables") as LuaReference, count=await this.syntax.length(variables);
        if(kind==="fornumber") {
          await this.expression(ctx,await this.syntax.get(node,"start") as LuaReference,active);
          await this.expression(ctx,await this.syntax.get(node,"limit") as LuaReference,active+1);
          const step=await this.syntax.get(node,"step") as LuaReference | undefined;
          if(step) await this.expression(ctx,step,active+2); else await this.load(ctx,active+2,await this.constant(ctx,{kind:"integer",value:1}),line);
        } else await this.values(ctx,await this.syntax.get(node,"values") as LuaReference,active,3);
        for(const name of ["(for control)","(for state)","(for step)"]) await this.bindings.declare(ctx.scope,await this.heap.string([new TextEncoder().encode(name)]));
        const prep=await this.bx(ctx,kind==="fornumber"?40:30,kind==="fornumber"?active:0,131071,line), bodyStart=await this.pc(ctx);
        const bodyParent=await this.enter(ctx);
        for(let i=0;i<count;i++) await this.bindings.declare(ctx.scope,await this.syntax.get(await this.syntax.at(variables,i) as LuaReference,"name") as LuaReference);
        this.reserve(ctx,active+3+count);
        await this.block(ctx,await this.syntax.get(node,"body") as LuaReference,false);
        await this.leave(ctx,bodyParent,line);
        const call=await this.pc(ctx);
        if(kind==="forin") await this.abc(ctx,41,active,0,count,line);
        const loop=await this.bx(ctx,kind==="fornumber"?39:42,kind==="fornumber"?active:active+2,131071,line);
        await this.loopJump(ctx,loop,bodyStart,kind==="fornumber"?39:42,kind==="fornumber"?active:active+2);
        if(kind==="fornumber") await this.loopJump(ctx,prep,loop,40,active); else await ctx.jumps.patch(prep,call);
        await ctx.jumps.label(ctx.jumpScope,await (this.breakName ??= this.heap.string([new TextEncoder().encode("break")])),await this.pc(ctx),active);
        await this.leave(ctx,parent,line); break;
      }
      case "break": case "goto": case "label": {
        const name=kind==="break"?await (this.breakName ??= this.heap.string([new TextEncoder().encode("break")])):
          await this.syntax.get(await this.syntax.get(node,"name") as LuaReference,"name") as LuaReference;
        if(kind==="label") await ctx.jumps.label(ctx.jumpScope,name,await this.pc(ctx),labelActive ?? active);
        else await ctx.jumps.go(ctx.jumpScope,name,await this.bx(ctx,30,0,131071,line),active);
        break;
      }
      default: this.fail(`invalid statement node ${kind}`);
    }
  }
  private async functionBody(body: LuaReference,node?: LuaReference,outer?: LuaReference): Promise<number> {
    const parameters=node?await this.syntax.get(node,"parameters") as LuaReference:undefined;
    const method=node?Boolean(await this.syntax.get(node,"method")):false, count=parameters?await this.syntax.length(parameters):0;
    const vararg=node?Boolean(await this.syntax.get(node,"vararg")):true;
    if(count+Number(method)>200) this.fail("too many local variables (limit is 200)");
    const prototype=await this.program.create({parameters:count+Number(method),vararg,registers:2});
    const scope=await this.bindings.enterFunction(prototype,outer), jumps=new LuaJumps(this.heap,this.program,prototype);
    const ctx: FunctionState={prototype,scope,jumps,jumpScope:await jumps.enterBlock(0),constants:await this.heap.table(),integers:await this.heap.table(),registers:2,vararg};
    if(method) await this.bindings.declare(scope,await this.heap.string([new TextEncoder().encode("self")]));
    if(parameters) for(let i=0;i<count;i++) await this.bindings.declare(scope,await this.syntax.get(await this.syntax.at(parameters,i) as LuaReference,"name") as LuaReference);
    this.reserve(ctx,count+Number(method));
    await this.block(ctx,body,false);
    await this.abc(ctx,38,0,1,0,(await this.syntax.describe(body)).line);
    await jumps.leaveBlock(ctx.jumpScope); await this.program.setRegisters(prototype,ctx.registers);
    return prototype;
  }
  async compile(root: LuaReference): Promise<number> {
    if((await this.syntax.describe(root)).kind!=="list") throw new TypeError("Expected Lua block");
    return this.functionBody(root);
  }
}
