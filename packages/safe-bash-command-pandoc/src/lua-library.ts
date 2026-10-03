import type {LuaProgram,LuaCapture} from "./lua-program.js";
import type {LuaStorage,LuaReference} from "./lua-storage.js";

export interface LuaLibraryPrototype {
  parameters:number;
  vararg:boolean;
  registers:number;
  instructions:readonly (readonly [number,number])[];
  constants:readonly (null | boolean | number | {integer:number} | {bytes:readonly number[]})[];
  captures:readonly LuaCapture[];
  children:readonly LuaLibraryPrototype[];
}

/** Only bundled, immutable library prototypes use this loader. Filter source is
 * compiled directly into retained storage; it never becomes a resident tree. */
export async function loadLuaLibrary(library:LuaLibraryPrototype,heap:LuaStorage,program:LuaProgram,source:LuaReference):Promise<number> {
  const prototype=await program.create({parameters:library.parameters,vararg:library.vararg,registers:library.registers,source});
  for(const constant of library.constants) await program.addConstant(prototype,constant===null?undefined:typeof constant==="object"?
    "integer" in constant?{kind:"integer",value:constant.integer}:await heap.string([Uint8Array.from(constant.bytes)]):constant);
  for(const [code,line] of library.instructions) await program.emit(prototype,code,line);
  for(const capture of library.captures) await program.addCapture(prototype,capture);
  for(const child of library.children) await program.addChild(prototype,await loadLuaLibrary(child,heap,program,source));
  return prototype;
}
