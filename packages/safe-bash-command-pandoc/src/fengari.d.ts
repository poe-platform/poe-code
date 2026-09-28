declare module "fengari" {
  interface State { readonly __luaState: unique symbol }
  export function to_jsstring(value: Uint8Array): string;
  export function to_luastring(text: string): Uint8Array;
  export const lua: {
    LUA_REGISTRYINDEX: number;
    LUA_OK: number; LUA_MASKCOUNT: number;
    lua_close(state: State): void;
    lua_sethook(state: State, hook: () => void, mask: number, count: number): void;
    lua_getglobal(state: State, name: Uint8Array): number;
    lua_setglobal(state: State, name: Uint8Array): void;
    lua_getfield(state: State, index: number, name: Uint8Array): number;
    lua_setfield(state: State, index: number, name: Uint8Array): void;
    lua_pushnil(state: State): void;
    lua_pushstring(state: State, text: Uint8Array): void;
    lua_pushvalue(state: State, index: number): void;
    lua_newtable(state: State): void;
    lua_isnil(state: State, index: number): boolean;
    lua_isfunction(state: State, index: number): boolean;
    lua_istable(state: State, index: number): boolean;
    lua_type(state: State, index: number): number;
    LUA_TTABLE: number;
    lua_tolstring(state: State, index: number): Uint8Array | null;
    LUA_TSTRING: number;
    lua_tojsstring(state: State, index: number): string | null;
    lua_pop(state: State, count: number): void;
    lua_next(state: State, index: number): boolean;
    LUA_TNUMBER: number;
    lua_rawlen(state: State, index: number): number;
    lua_rawgeti(state: State, index: number, key: number): number;
    lua_tointeger(state: State, index: number): number;
    lua_pcall(state: State, args: number, results: number, handler: number): number;
  };
  export const lauxlib: {
    luaL_ref(state: State, index: number): number;
    luaL_newstate(): State;
    luaL_requiref(state: State, name: Uint8Array, open: (state: State) => number, global: boolean): void;
    luaL_loadbuffer(state: State, source: Uint8Array, length: number, name: Uint8Array): number;
    luaL_loadbufferx(state: State, bytes: Uint8Array, length: number, name: Uint8Array, mode: Uint8Array): number;
  };
  export const lualib: {
    luaopen_table(state: State): number;
    luaopen_math(state: State): number;
    luaopen_utf8(state: State): number;
    luaopen_base(state: State): number;
    luaopen_string(state: State): number;
  };
}

declare module "fengari/src/lua.js" { const api: typeof import("fengari").lua; export default api; }
declare module "fengari/src/lauxlib.js" { const api: typeof import("fengari").lauxlib; export default api; }
declare module "fengari/src/fengaricore.js" { export {to_luastring, to_jsstring} from "fengari"; }
declare module "fengari/src/lbaselib.js" { const api: Pick<typeof import("fengari").lualib, "luaopen_base">; export default api; }
declare module "fengari/src/lstrlib.js" { const api: Pick<typeof import("fengari").lualib, "luaopen_string">; export default api; }
declare module "fengari/src/ltablib.js" { const api: Pick<typeof import("fengari").lualib, "luaopen_table">; export default api; }
declare module "fengari/src/lmathlib.js" { const api: Pick<typeof import("fengari").lualib, "luaopen_math">; export default api; }
declare module "fengari/src/lutf8lib.js" { const api: Pick<typeof import("fengari").lualib, "luaopen_utf8">; export default api; }
