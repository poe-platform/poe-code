declare module "fengari" {
  interface State {readonly luaState: unique symbol}
  type OpenLibrary = (state: State) => number;
  export function to_luastring(value: string): Uint8Array;
  export function to_jsstring(value: Uint8Array): string;
  export const lua: {
    LUA_OK: number; LUA_MASKCOUNT: number; LUA_TSTRING: number; LUA_TTABLE: number;
    lua_close(state: State): void;
    lua_sethook(state: State, hook: () => void, mask: number, count: number): void;
    lua_getglobal(state: State, name: Uint8Array): number;
    lua_setglobal(state: State, name: Uint8Array): void;
    lua_pushnil(state: State): void;
    lua_pushstring(state: State, value: Uint8Array): void;
    lua_newtable(state: State): void;
    lua_setfield(state: State, index: number, name: Uint8Array): void;
    lua_getfield(state: State, index: number, name: Uint8Array): number;
    lua_pop(state: State, count: number): void;
    lua_isnil(state: State, index: number): boolean;
    lua_isfunction(state: State, index: number): boolean;
    lua_type(state: State, index: number): number;
    lua_tolstring(state: State, index: number): Uint8Array | null;
    lua_pcall(state: State, nargs: number, nresults: number, handler: number): number;
  };
  export const lauxlib: {
    luaL_newstate(): State;
    luaL_requiref(state: State, name: Uint8Array, open: OpenLibrary, global: boolean): void;
    luaL_loadbuffer(state: State, source: Uint8Array, length: number, name: Uint8Array): number;
  };
  export const lualib: {
    luaopen_base: OpenLibrary; luaopen_string: OpenLibrary; luaopen_table: OpenLibrary;
    luaopen_math: OpenLibrary; luaopen_utf8: OpenLibrary;
  };
}
