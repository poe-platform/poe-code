import {lua, lauxlib, lualib, to_luastring, to_jsstring} from "fengari";
import {PandocError} from "./errors.js";
import type {FilterCapability, Document} from "./types.js";

/** Only use trusted sources: Lua VM allocations are not isolated or metered.
 * The reader grants access to explicitly configured local filter files only. */
export interface LuaFilterOptions {
  readFile(path: string, signal: AbortSignal | undefined): Promise<Uint8Array>;
}

/** Execute genuine Lua Str callbacks without a host interpreter or ambient I/O.
 * Other Pandoc callbacks, constructors and returned filter tables are unsupported. */
export function createLuaFilterCapability(options: LuaFilterOptions): FilterCapability {
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
        if (!lua.lua_isnil(state, -1)) fail("E_UNSUPPORTED_FEATURE", "Returned Lua filter tables are unsupported");
        lua.lua_pop(state, 1);
        for (const name of [
          "Pandoc", "Meta", "Inline", "Inlines", "Block", "Blocks", "Space", "SoftBreak", "LineBreak",
          "Emph", "Underline", "Strong", "Strikeout", "Superscript", "Subscript", "SmallCaps", "Quoted",
          "Cite", "Code", "Math", "RawInline", "Link", "Image", "Note", "Span", "Plain", "Para", "LineBlock",
          "CodeBlock", "RawBlock", "BlockQuote", "OrderedList", "BulletList", "DefinitionList", "Header",
          "HorizontalRule", "Div", "Figure", "Table"
        ]) {
          lua.lua_getglobal(state, to_luastring(name));
          if (!lua.lua_isnil(state, -1)) fail("E_UNSUPPORTED_FEATURE", `Lua callback ${name} is unsupported`);
          lua.lua_pop(state, 1);
        }
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
