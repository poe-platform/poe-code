import {PandocError} from "./errors.js";
import {integer,integral,isInteger,numeric} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaStrings} from "./lua-strings.js";
import {LuaMetatables} from "./lua-metatables.js";
import type {LuaArguments,LuaNativeContext,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";

const unary={acos:Math.acos,asin:Math.asin,cos:Math.cos,exp:Math.exp,sin:Math.sin,sqrt:Math.sqrt,tan:Math.tan,
  deg:(value:number)=>value*(180/Math.PI),rad:(value:number)=>value*(Math.PI/180)};
const names=[...Object.keys(unary),"abs","atan","ceil","floor","fmod","log","max","min","modf","random","randomseed","tointeger","type","ult"];
function fail(message:string):never {throw new PandocError("E_AST","convert",message);}
function tagged(value:number):StoredLuaValue {return (value|0)===value?{kind:"integer",value}:value;}

/** Fixed-size math state; variadic comparisons resume from caller-backed frames. */
export class LuaMath {
  private readonly numbers:LuaNumbers;
  private readonly strings:LuaStrings;
  private readonly metatables:LuaMetatables;
  private randomState:number | undefined;
  constructor(private readonly heap:LuaStorage) {
    this.numbers=new LuaNumbers(heap); this.strings=new LuaStrings(heap); this.metatables=new LuaMetatables(heap);
  }
  async install(environment:LuaReference):Promise<void> {
    const library=await this.heap.table(), key=(name:string)=>this.heap.string([new TextEncoder().encode(name)]);
    for(let i=0;i<names.length;i++) await this.heap.set(library,await key(names[i]!),await this.heap.closure(-200-i,[]));
    for(const [name,value] of Object.entries({pi:Math.PI,huge:Infinity,mininteger:integer(-2147483648),maxinteger:integer(2147483647)}))
      await this.heap.set(library,await key(name),value);
    await this.heap.set(environment,await key("math"),library);
  }
  async invoke(prototype:number,args:LuaArguments,context:LuaNativeContext):Promise<LuaNativeOutput> {
    const name=names[-200-prototype];
    if(!name) throw new PandocError("E_UNSUPPORTED_FEATURE","convert","Unknown Lua math function");
    if(name!=="random" && !args.count) fail("Value expected");
    if(name==="min" || name==="max") return this.extreme(name,args,context);
    const value=await args.get(0);
    if(name==="type") return [typeof value==="number" || isInteger(value)?await this.heap.string([new TextEncoder().encode(isInteger(value)?"integer":"float")]):undefined];
    if(name==="tointeger") {
      try {return [{kind:"integer",value:integral(await this.numbers.coerce(value))}];}
      catch(error) {if(error instanceof PandocError && error.code==="E_AST") return [undefined]; throw error;}
    }
    if(name==="random") {
      // Match the shipped engine's sequence, including binary64 multiplication.
      const random=this.randomState===undefined?Math.random():this.advanceRandom()/0x80000000;
      if(!args.count) return [random];
      if(args.count>2) fail("Wrong number of arguments");
      const first=integral(await this.numbers.coerce(value));
      const low=args.count===1?1:first,high=args.count===1?first:integral(await this.numbers.coerce(await args.get(1)));
      if(low>high) fail("Interval is empty");
      if(low<0 && high>2147483647+low) fail("Interval too large");
      return [integer(Math.floor(random*(high-low+1))+low)];
    }
    const number=numeric(await this.numbers.coerce(value));
    if(Object.hasOwn(unary,name)) return [unary[name as keyof typeof unary](number)];
    switch(name) {
      case "randomseed": this.randomState=(number|0) || 1; this.advanceRandom(); return [];
      case "abs": return [isInteger(value)?number<0?integer(-number):value:Math.abs(number)];
      case "ceil": return [tagged(Math.ceil(number))];
      case "floor": return [tagged(Math.floor(number))];
      case "modf": {
        if(isInteger(value)) return [value,0];
        const whole=number<0?Math.ceil(number):Math.floor(number);
        return [tagged(whole),number===whole?0:number-whole];
      }
      case "atan": {const x=await args.get(1); return [Math.atan2(number,x===undefined?1:numeric(await this.numbers.coerce(x)))];}
      case "log": {
        const base=await args.get(1);
        if(base===undefined) return [Math.log(number)];
        const radix=numeric(await this.numbers.coerce(base));
        return [radix===2?Math.log2(number):radix===10?Math.log10(number):Math.log(number)/Math.log(radix)];
      }
      case "fmod": {
        const second=await args.get(1), divisor=numeric(await this.numbers.coerce(second));
        if(isInteger(value) && isInteger(second)) {if(divisor===0) fail("Zero divisor"); return [integer(number%divisor)];}
        return [number%divisor];
      }
      case "ult": return [(integral(await this.numbers.coerce(value))>>>0)<(integral(await this.numbers.coerce(await args.get(1)))>>>0)];
      default: return fail("Unknown Lua math operation");
    }
  }
  private advanceRandom():number {
    this.randomState=(1103515245*this.randomState!+12345)&0x7fffffff;
    return this.randomState;
  }
  private async extreme(name:string,args:LuaArguments,context:LuaNativeContext):Promise<LuaNativeOutput> {
    let best=0,index=1;
    if(context.continuation) {
      best=await this.heap.get(context.state,0) as number;
      index=await this.heap.get(context.state,1) as number;
      const result=await context.results.get(0);
      if(result!==undefined && result!==false) best=index;
      index++;
    }
    for(;index<args.count;index++) {
      const candidate=await args.get(index),previous=await args.get(best);
      const left=name==="min"?candidate:previous,right=name==="min"?previous:candidate;
      let less:boolean;
      if((typeof left==="number" || isInteger(left)) && (typeof right==="number" || isInteger(right))) less=numeric(left)<numeric(right);
      else if(typeof left==="object" && left.kind==="string" && typeof right==="object" && right.kind==="string") less=await this.strings.compare(left,right)<0;
      else {
        const call=await this.metatables.binary(left,right,"__lt");
        if(!call) return fail("Cannot compare Lua values");
        await this.heap.set(context.state,0,best); await this.heap.set(context.state,1,index);
        return {call,continuation:1};
      }
      if(less) best=index;
    }
    return [await args.get(best)];
  }
}
