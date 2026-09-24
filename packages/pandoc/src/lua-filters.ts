import {lua, lauxlib, lualib, to_luastring, to_jsstring} from "fengari";
import {PandocError} from "./errors.js";
import type {FilterCapability, Document} from "./types.js";

/** Only use trusted sources: Lua VM allocations are not isolated or metered.
 * The reader grants access to explicitly configured local filter files only. */
export interface LuaFilterOptions {
  readFile(path: string, signal: AbortSignal | undefined): Promise<Uint8Array>;
}

/** Execute genuine Lua Str callbacks without a host interpreter or ambient I/O.
 * Str may be global or returned in a single filter table. Other callbacks and
 * Pandoc constructors are unsupported. */
function createReaderLuaFilterCapability(options: LuaFilterOptions): FilterCapability {
  if (!options || typeof options.readFile !== "function") throw new TypeError("A local Lua filter reader is required");
  return {
    supports: request => request.kind === "lua",
    async apply(document, request, context) {
      if (request.kind !== "lua") throw new PandocError("E_CAPABILITY", "convert", "This capability supports Lua filters only");
      const source = await options.readFile(request.path, context.signal);
      context.checkpoint();
      if (!(source instanceof Uint8Array)) throw new PandocError("E_IO", "convert", "Lua filter source must be bytes");
      context.charge("inputBytes", source.byteLength);
      context.charge("retainedBytes", source.byteLength);
      const state = lauxlib.luaL_newstate();
      let hookFailure: unknown;
      const fail = (code: "E_AST" | "E_UNSUPPORTED_FEATURE", message: string): never => {
        throw new PandocError(code, "convert", message);
      };
      const checked = (status: number) => {
        if (hookFailure) throw hookFailure;
        if (status !== lua.LUA_OK) {
          const message = lua.lua_tolstring(state, -1);
          fail("E_AST", message ? to_jsstring(message) : "Lua filter execution failed");
        }
      };
      try {
        for (const [name, open] of [
          ["_G", lualib.luaopen_base], ["string", lualib.luaopen_string],
          ["table", lualib.luaopen_table], ["math", lualib.luaopen_math], ["utf8", lualib.luaopen_utf8]
        ] as const) {
          lauxlib.luaL_requiref(state, to_luastring(name), open, true);
          lua.lua_pop(state, 1);
        }
        // Protected calls cannot be allowed to swallow the work-budget hook.
        for (const name of ["dofile", "loadfile", "load", "print", "pcall", "xpcall"]) {
          lua.lua_pushnil(state);
          lua.lua_setglobal(state, to_luastring(name));
        }
        lua.lua_pushstring(state, to_luastring(context.to.split("+")[0]!.split("-")[0]!));
        lua.lua_setglobal(state, to_luastring("FORMAT"));
        lua.lua_sethook(state, () => {
          try {context.checkpoint(100);} catch (error) {hookFailure = error; throw error;}
        }, lua.LUA_MASKCOUNT, 100);
        // Only text Lua is accepted; VM bytecode has no validated provenance.
        if (source[0] === 27) fail("E_UNSUPPORTED_FEATURE", "Lua bytecode filters are unsupported");
        checked(lauxlib.luaL_loadbuffer(state, source, source.length, to_luastring(request.path)));
        checked(lua.lua_pcall(state, 0, 1, 0));
        const returnedTable = !lua.lua_isnil(state, -1);
        if (returnedTable && lua.lua_type(state, -1) !== lua.LUA_TTABLE)
          fail("E_UNSUPPORTED_FEATURE", "Expected a Lua filter table");
        if (returnedTable) {
          lua.lua_pushnil(state);
          while (lua.lua_next(state, -2)) {
            const name = lua.lua_tolstring(state, -2);
            if (!name || to_jsstring(name) !== "Str")
              fail("E_UNSUPPORTED_FEATURE", "Returned Lua filter tables support only Str");
            lua.lua_pop(state, 1);
          }
        }
        for (const name of [
          "Pandoc", "Meta", "Inline", "Inlines", "Block", "Blocks", "Space", "SoftBreak", "LineBreak",
          "Emph", "Underline", "Strong", "Strikeout", "Superscript", "Subscript", "SmallCaps", "Quoted",
          "Cite", "Code", "Math", "RawInline", "Link", "Image", "Note", "Span", "Plain", "Para", "LineBlock",
          "CodeBlock", "RawBlock", "BlockQuote", "OrderedList", "BulletList", "DefinitionList", "Header",
          "HorizontalRule", "Div", "Figure", "Table"
        ]) {
          if (returnedTable) lua.lua_getfield(state, -1, to_luastring(name));
          else lua.lua_getglobal(state, to_luastring(name));
          if (!lua.lua_isnil(state, -1)) fail("E_UNSUPPORTED_FEATURE", `Lua callback ${name} is unsupported`);
          lua.lua_pop(state, 1);
        }
        if (returnedTable) {
          lua.lua_getfield(state, -1, to_luastring("Str"));
          lua.lua_setglobal(state, to_luastring("Str"));
        }
        lua.lua_pop(state, 1);
        lua.lua_getglobal(state, to_luastring("Str"));
        const hasStr = !lua.lua_isnil(state, -1);
        if (hasStr && !lua.lua_isfunction(state, -1)) fail("E_AST", "Lua Str callback must be a function");
        lua.lua_pop(state, 1);
        if (!hasStr) return document;
        const visit = async (value: unknown, depth: number): Promise<unknown> => {
          await context.cooperate();
          context.bound("depth", depth);
          if (!value || typeof value !== "object") return value;
          if ("t" in value && value.t === "Str" && "c" in value && typeof value.c === "string") {
            lua.lua_getglobal(state, to_luastring("Str"));
            lua.lua_newtable(state);
            lua.lua_pushstring(state, to_luastring(value.c));
            lua.lua_setfield(state, -2, to_luastring("text"));
            lua.lua_pushstring(state, to_luastring("Str"));
            lua.lua_setfield(state, -2, to_luastring("tag"));
            checked(lua.lua_pcall(state, 1, 1, 0));
            if (lua.lua_isnil(state, -1)) {lua.lua_pop(state, 1); return value;}
            if (lua.lua_type(state, -1) !== lua.LUA_TTABLE) fail("E_AST", "Lua Str must return an element or nil");
            lua.lua_getfield(state, -1, to_luastring("tag"));
            const tag = lua.lua_tolstring(state, -1);
            if (!tag || to_jsstring(tag) !== "Str") fail("E_UNSUPPORTED_FEATURE", "Lua Str replacements must remain Str elements");
            lua.lua_pop(state, 1);
            if (lua.lua_getfield(state, -1, to_luastring("text")) !== lua.LUA_TSTRING) fail("E_AST", "Lua Str text must be a string");
            const bytes = lua.lua_tolstring(state, -1)!;
            context.charge("retainedBytes", bytes.length * 2);
            const text = to_jsstring(bytes);
            context.charge("text", text.length);
            lua.lua_pop(state, 2);
            return {t: "Str", c: text};
          }
          context.charge("references", Object.keys(value).length);
          if (Array.isArray(value)) {
            const result: unknown[] = [];
            for (const child of value) result.push(await visit(child, depth + 1));
            return result.every((child, index) => child === value[index]) ? value : result;
          }
          const result: Record<string, unknown> = {};
          for (const [key, child] of Object.entries(value)) result[key] = await visit(child, depth + 1);
          return Object.entries(result).every(([key, child]) => child === (value as Record<string, unknown>)[key]) ? value : result;
        };
        // Resources, language/direction and parser sidecars stay SDK-owned.
        const metadata = await visit(document.metadata, 0) as Document["metadata"];
        const blocks = await visit(document.blocks, 0) as Document["blocks"];
        return {...document, metadata, blocks};
      } finally {lua.lua_close(state);}
    }
  };
}


/** Explicit script authority. Only trusted scripts: VM allocations are not isolated. */
export type LuaScriptLoader = (path: string, signal: AbortSignal | undefined) => Promise<Uint8Array>;

/** Genuine Lua 5.3, limited to Str callbacks returning a Str or nil.
 * Each conversion owns a fresh VM. No host file, process, or module APIs. */
export function createLuaFilterCapability(load: LuaScriptLoader | LuaFilterOptions): FilterCapability {
  if (typeof load === "object") return createReaderLuaFilterCapability(load);
  if (typeof load !== "function") throw new TypeError("A Lua script loader is required");
  return {
    supports: request => request.kind === "lua",
    async apply(document, request, context) {
      if (request.kind !== "lua") throw new PandocError("E_CAPABILITY", "convert", "This runtime supports Lua filters only");
      const source = await load(request.path, context.signal);
      context.checkpoint();
      if (!(source instanceof Uint8Array)) throw new PandocError("E_IO", "convert", "Lua scripts must be bytes");
      context.charge("inputBytes", source.byteLength);
      context.charge("retainedBytes", source.byteLength);
      const {lua, lauxlib, lualib, to_luastring} = await import("fengari");
      context.checkpoint();
      const state = lauxlib.luaL_newstate();
      const fail = (code: "E_IO" | "E_AST" | "E_UNSUPPORTED_FEATURE", message: string): never => {
        throw new PandocError(code, "convert", message);
      };
      const call = (args: number) => {
        const status = lua.lua_pcall(state, args, 1, 0);
        context.checkpoint();
        if (status !== lua.LUA_OK) fail("E_IO", lua.lua_tojsstring(state, -1) ?? "Lua filter failed");
      };
      try {
        lauxlib.luaL_requiref(state, to_luastring("_G"), lualib.luaopen_base, true);
        lua.lua_pop(state, 1);
        lauxlib.luaL_requiref(state, to_luastring("string"), lualib.luaopen_string, true);
        lua.lua_pop(state, 1);
        for (const name of ["dofile", "loadfile", "load", "print", "collectgarbage"]) {
          lua.lua_pushnil(state);
          lua.lua_setglobal(state, to_luastring(name));
        }
        // Keep only predictable string operations; no pattern engine or formatting.
        lua.lua_getglobal(state, to_luastring("string"));
        for (const name of ["dump", "rep", "format", "find", "match", "gmatch", "gsub"]) {
          lua.lua_pushnil(state);
          lua.lua_setfield(state, -2, to_luastring(name));
        }
        lua.lua_pop(state, 1);
        lua.lua_sethook(state, () => context.checkpoint(100), lua.LUA_MASKCOUNT, 100);
        const status = lauxlib.luaL_loadbufferx(state, source, source.length, to_luastring(request.path), to_luastring("t"));
        if (status !== lua.LUA_OK) fail("E_IO", lua.lua_tojsstring(state, -1) ?? "Invalid Lua script");
        call(0);
        if (lua.lua_isnil(state, -1)) {
          lua.lua_pop(state, 1);
          lua.lua_getglobal(state, to_luastring("_G"));
          // Global helpers must be local, so unsupported callbacks cannot be ignored.
          const baseline = new Set(["assert", "error", "getmetatable", "ipairs", "next", "pairs", "pcall", "rawequal", "rawget", "rawlen", "rawset", "select", "setmetatable", "tonumber", "tostring", "type", "xpcall"]);
          lua.lua_pushnil(state);
          while (lua.lua_next(state, -2)) {
            const key = lua.lua_tojsstring(state, -2);
            if (lua.lua_isfunction(state, -1) && key !== "Str" && !baseline.has(key ?? "")) fail("E_UNSUPPORTED_FEATURE", "Only Str callbacks and local helpers are supported");
            lua.lua_pop(state, 1);
          }
        } else {
          if (!lua.lua_istable(state, -1)) fail("E_UNSUPPORTED_FEATURE", "Expected a Lua filter table");
          lua.lua_pushnil(state);
          while (lua.lua_next(state, -2)) {
            if (lua.lua_tojsstring(state, -2) !== "Str") fail("E_UNSUPPORTED_FEATURE", "Only Str callbacks are supported");
            lua.lua_pop(state, 1);
          }
        }
        lua.lua_getfield(state, -1, to_luastring("Str"));
        if (!lua.lua_isfunction(state, -1)) fail("E_UNSUPPORTED_FEATURE", "A Str callback is required");
        const walk = async (value: unknown): Promise<unknown> => {
          await context.cooperate();
          if (!value || typeof value !== "object") return value;
          if ("t" in value && value.t === "Str" && "c" in value && typeof value.c === "string") {
            context.charge("retainedBytes", value.c.length * 2);
            lua.lua_pushvalue(state, -1);
            lua.lua_newtable(state);
            lua.lua_pushstring(state, to_luastring("Str"));
            lua.lua_setfield(state, -2, to_luastring("tag"));
            lua.lua_pushstring(state, to_luastring(value.c));
            lua.lua_setfield(state, -2, to_luastring("text"));
            call(1);
            let text = value.c;
            if (!lua.lua_isnil(state, -1)) {
              if (!lua.lua_istable(state, -1)) fail("E_AST", "Str callbacks must return a Str or nil");
              lua.lua_getfield(state, -1, to_luastring("tag"));
              if (lua.lua_tojsstring(state, -1) !== "Str") fail("E_AST", "Str callbacks must return a Str or nil");
              lua.lua_pop(state, 1);
              lua.lua_getfield(state, -1, to_luastring("text"));
              if (lua.lua_type(state, -1) !== lua.LUA_TSTRING) fail("E_AST", "Str text must be a string");
              text = lua.lua_tojsstring(state, -1)!;
              context.charge("text", text.length);
              context.charge("retainedBytes", text.length * 2);
              lua.lua_pop(state, 1);
            }
            lua.lua_pop(state, 1);
            return {...value, c: text};
          }
          // Copy only changed branches, retaining parser-owned image origin tuples.
          if (Array.isArray(value)) {
            context.charge("references", value.length);
            context.charge("retainedBytes", value.length * 8);
            const children = [];
            for (const child of value) children.push(await walk(child));
            return children.every((child, index) => child === value[index]) ? value : children;
          }
          const entries = [];
          let changed = false;
          for (const [key, child] of Object.entries(value)) {
            context.charge("references", 1);
            context.charge("retainedBytes", 16);
            const result = await walk(child);
            changed ||= result !== child;
            entries.push([key, result]);
          }
          return changed ? Object.fromEntries(entries) : value;
        };
        return {...document, blocks: await walk(document.blocks) as typeof document.blocks, metadata: await walk(document.metadata) as typeof document.metadata};
      } finally {
        lua.lua_close(state);
      }
    }
  };
}
