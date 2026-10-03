import fengari from "fengari";

/** Build-only compiler for immutable library code, never filter input. */
export function compileLuaLibrary(source) {
  const {lua,lauxlib,to_luastring,to_jsstring}=fengari,state=lauxlib.luaL_newstate();
  try {
    const bytes=to_luastring(source);
    if(lauxlib.luaL_loadbuffer(state,bytes,bytes.length,to_luastring("@table"))!==lua.LUA_OK)
      throw new Error(to_jsstring(lua.lua_tostring(state,-1)));
    const convert=prototype=>({
      parameters:prototype.numparams,vararg:Boolean(prototype.is_vararg),registers:prototype.maxstacksize,
      instructions:prototype.code.map((instruction,index)=>[instruction.code>>>0,prototype.lineinfo[index]]),
      constants:prototype.k.map(constant=>{
        switch(constant.type) {
          case 0:return null;
          case 1:case 3:return constant.value;
          case 19:return {integer:constant.value};
          case 4:case 20:return {bytes:Array.from(constant.value.getstr())};
          default:throw new TypeError("Unsupported library constant");
        }
      }),
      captures:prototype.upvalues.map(capture=>({register:capture.instack,index:capture.idx})),
      children:prototype.p.map(convert)
    });
    return convert(state.stack[state.top-1].value.p);
  } finally {lua.lua_close(state);}
}
