import {PandocError} from "./errors.js";
import {integral,integer} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaMetatables} from "./lua-metatables.js";
import {LuaStrings} from "./lua-strings.js";
import {loadLuaLibrary} from "./lua-library.js";
import {tableLibrary} from "./lua-table.generated.js";
import type {LuaProgram} from "./lua-program.js";
import type {LuaMachine,LuaArguments,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";

/** Table algorithms run as retained Lua; fixed native helpers never call Lua. */
export class LuaTable {
  private readonly numbers:LuaNumbers;
  private readonly strings:LuaStrings;
  private readonly metatables:LuaMetatables;
  private countKey:LuaReference | undefined;
  constructor(private readonly heap:LuaStorage) {
    this.numbers=new LuaNumbers(heap); this.strings=new LuaStrings(heap); this.metatables=new LuaMetatables(heap);
  }
  async install(environment:LuaReference,program:LuaProgram,machine:LuaMachine):Promise<void> {
    const heap=this.heap,source=await heap.string([new TextEncoder().encode("@table")]);
    const prototype=await loadLuaLibrary(tableLibrary,heap,program,source);
    const closure=await heap.closure(prototype,[await heap.cell(environment)]);
    const result=await machine.run(closure,(async function*(){for(let i=0;i<7;i++) yield await heap.closure(-400-i,[]);})());
    await heap.set(environment,await heap.string([new TextEncoder().encode("table")]),await heap.get(result.values,0));
  }
  async invoke(prototype:number,args:LuaArguments):Promise<LuaNativeOutput> {
    const heap=this.heap,value=await args.get(0);
    switch(prototype) {
      case -400: {
        const table=await heap.table();
        for(let i=args.count;i>0;i--) await heap.set(table,integer(i),await args.get(i-1));
        this.countKey ??= await heap.string([new TextEncoder().encode("n")]);
        await heap.set(table,this.countKey,integer(args.count));
        return [table];
      }
      case -401: return [{kind:"integer",value:integral(await this.numbers.coerce(value))}];
      case -402: return [typeof value==="object" && value.kind==="string"?value:await this.strings.concat((async function*(){yield value;})())];
      case -403: {
        const count=await this.numbers.coerce(await args.get(1)),separator=await args.get(2);
        return [await this.strings.concat((async function*(){
          for(let i=1;i<=count;i++) {if(i>1) yield separator;yield await heap.get(value as LuaReference,i);}
        })())];
      }
      case -404: {
        const length=await this.numbers.coerce(await args.get(1));
        return (async function*():AsyncGenerator<StoredLuaValue>{for(let i=1;i<=length;i++) yield await heap.get(value as LuaReference,i);})();
      }
      case -405: return [Math.floor(Math.random()*0x100000000)];
      case -406: {
        if(typeof value==="object" && value.kind==="table") return [];
        const mask=integral(await args.get(1));
        for(const [bit,name] of [[1,"__index"],[2,"__newindex"],[4,"__len"]] as const)
          if(mask&bit && await this.metatables.method(value,name)===undefined) throw new PandocError("E_AST","convert","Expected Lua table");
        return [];
      }
      default: throw new PandocError("E_UNSUPPORTED_FEATURE","convert","Unknown Lua table helper");
    }
  }
}
