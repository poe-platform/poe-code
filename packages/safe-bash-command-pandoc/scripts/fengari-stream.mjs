import lua from "fengari/src/lua.js";
import {luaF_initupvals} from "fengari/src/lfunc.js";
import {luaH_getint} from "fengari/src/ltable.js";
import {MBuffer} from "fengari/src/lzio.js";
import {Dyndata, luaY_parser} from "fengari-async-parser";

// Private one-shot loader: the caller closes this VM after any failed load.
// Bytecode remains disallowed; only the upstream text compiler is made async.
export async function loadStream(state, reader, name) {
  const previous = state.errorJmp;
  const jump = {status: lua.LUA_OK, previous};
  const calls = state.nCcalls;
  const yields = state.nny;
  state.errorJmp = jump;
  state.nny++;
  let buffer = new Uint8Array(0), offset = 0;
  const input = {async zgetc() {
    while (offset === buffer.length) {
      const next = await reader();
      if (next === null) return -1;
      buffer = next;
      offset = 0;
    }
    return buffer[offset++];
  }};
  try {
    const first = await input.zgetc();
    if (first === 27) throw new TypeError("Lua bytecode filters are unsupported");
    const closure = await luaY_parser(state, input, new MBuffer(), new Dyndata(), name, first);
    luaF_initupvals(state, closure);
    if (closure.nupvalues >= 1)
      closure.upvals[0].setfrom(luaH_getint(state.l_G.l_registry.value, lua.LUA_RIDX_GLOBALS));
    return lua.LUA_OK;
  } catch (error) {
    if (error !== jump) throw error;
    return jump.status;
  } finally {
    state.errorJmp = previous;
    state.nCcalls = calls;
    state.nny = yields;
  }
}
