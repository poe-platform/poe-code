import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import type {AdapterContext} from "./types.js";
import {PandocError} from "./errors.js";
import {LuaError} from "./lua-error.js";
import {LuaStorage,type LuaReference} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import {LuaFrames} from "./lua-frames.js";
import {LuaMachine} from "./lua-machine.js";
import {LuaLexer} from "./lua-lexer.js";
import {LuaSyntax} from "./lua-syntax.js";
import {LuaParser} from "./lua-parser.js";
import {LuaCompiler} from "./lua-compiler.js";
import {LuaBase} from "./lua-base.js";
import {LuaMath} from "./lua-math.js";
import {LuaUtf8} from "./lua-utf8.js";
import {LuaTable} from "./lua-table.js";
import {LuaStringLibrary} from "./lua-string-library.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaJsonBridge} from "./lua-json.js";
import {loadLuaLibrary} from "./lua-library.js";
import {pandocLibrary} from "./lua-pandoc.generated.js";

/** The caller owns all three stores and their lifetime, including retained
 * error payloads. This private adapter does not activate the public filter path. */
export async function applyRetainedLuaFilter(input:BackedJson,output:BackedJson,source:AsyncIterable<Uint8Array> | Iterable<Uint8Array>,storage:PagedStorage,context:AdapterContext,to:string,path:string):Promise<void> {
  const cooperate=(units?:number)=>context.cooperate(units),heap=new LuaStorage(storage,cooperate),program=new LuaProgram(storage,heap,cooperate);
  const base=new LuaBase(heap),math=new LuaMath(heap),utf8=new LuaUtf8(heap),table=new LuaTable(heap),strings=new LuaStringLibrary(heap,cooperate),numbers=new LuaNumbers(heap);
  const environment=await heap.table(),key=(text:string)=>heap.string([new TextEncoder().encode(text)]);
  const machine=new LuaMachine(program,new LuaFrames(storage,heap,cooperate),heap,cooperate,async(prototype,args,native)=>{
    if(prototype===-1000){context.bound("depth",await numbers.coerce(await args.get(0)));return [];}
    if(prototype===-1001)throw new PandocError("E_AST","convert","Lua callback must return an element, list or nil");
    if(prototype===-1002 || prototype===-1003)throw new LuaError(await args.get(0),0,prototype===-1002?"E_UNSUPPORTED_FEATURE":"E_AST");
    if(prototype<=-500 && prototype>-600)return strings.invoke(prototype,args);
    if(prototype<=-400 && prototype>-500)return table.invoke(prototype,args);
    if(prototype<=-300 && prototype>-400)return utf8.invoke(prototype,args);
    if(prototype<=-200 && prototype>-300)return math.invoke(prototype,args,native);
    return base.invoke(prototype,args,native);
  });
  const closeSource=new LuaLexer((async function*(){
    let first=true;
    for await(const bytes of source) {
      context.checkpoint(0);
      if(!(bytes instanceof Uint8Array))throw new PandocError("E_IO","convert","Lua filter source must be bytes");
      if(bytes.length) {
        if(first && bytes[0]===27)throw new PandocError("E_UNSUPPORTED_FEATURE","convert","Lua bytecode filters are unsupported");
        first=false;
      }
      context.charge("inputBytes",bytes.length);yield bytes;
    }
  })(),heap,cooperate);
  let failure:{reason:unknown} | undefined;
  try {
    await base.install(environment);await math.install(environment);await utf8.install(environment);
    await strings.install(environment,program,machine);await table.install(environment,program,machine);
    for(const [name,id] of [["__pandoc_depth",-1000],["__pandoc_ast_error",-1001],["__pandoc_unsupported",-1002],["__pandoc_invalid",-1003]] as const)
      await heap.set(environment,await key(name),await heap.closure(id,[]));
    await heap.set(environment,await key("FORMAT"),await key(to.split("+")[0]!.split("-")[0]!));
    const bootstrap=await loadLuaLibrary(pandocLibrary,heap,program,await key("@pandoc constructors"));
    const environmentCell=await heap.cell(environment),bootstrapResult=await machine.run(await heap.closure(bootstrap,[environmentCell]),[]);
    const factory=await heap.get(bootstrapResult.values,0) as LuaReference;
    const syntax=new LuaSyntax(heap),root=await new LuaParser(closeSource,syntax).parse();
    const prototype=await new LuaCompiler(heap,program,syntax,await key("@"+path)).compile(root);
    const script=await machine.run(await heap.closure(prototype,[environmentCell]),[]);
    const captured=await machine.run(factory,[await heap.get(script.values,0)]),runner=await heap.get(captured.values,0) as LuaReference;
    const bridge=new LuaJsonBridge(heap,storage,cooperate),document=await bridge.read(input);
    const result=await machine.run(runner,[document]),value=await heap.get(result.values,0);
    if(typeof value!=="object" || value.kind!=="table")throw new PandocError("E_AST","convert","Invalid Lua document result");
    await bridge.markObject(await heap.get(value,await key("meta")));
    await bridge.write(value,output);
  } catch(reason) {failure={reason};}
  try {await closeSource.close();} catch(reason) {failure??={reason};}
  await context.cooperate(0);
  if(failure)throw failure.reason;
}
