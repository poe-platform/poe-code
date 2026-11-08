// Ambient declarations must follow source consumers without adding a runtime import.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./fengari.d.ts" />

import {PandocError} from "./errors.js";
import {applyLuaStream} from "./lua-stream-filter.js";
import {luaAst} from "./lua-ast.js";
import type {FilterCapability, Document} from "./types.js";

/** Trusted scripts; buffered apply retains its resident convenience behavior. */
export interface LuaFilterOptions {
  /** Consume the complete error message before backing storage closes. The same
   * error is then thrown; hosts can track its identity to avoid printing twice.
   * Without this callback, streamed errors are collected into Error.message. */
  onError?(error: PandocError, message: AsyncIterable<Uint8Array>): Promise<void>;
  /** Buffered source bytes are snapshotted before asynchronous runtime setup. */
  readFile(path: string, signal: AbortSignal | undefined): Promise<Uint8Array>;
  /** Sequential source capability; preferred when both readers are supplied. */
  readStream?(path: string, signal: AbortSignal | undefined): AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}
export interface LuaStreamFilterOptions extends Partial<LuaFilterOptions> {
  readStream: NonNullable<LuaFilterOptions["readStream"]>;
}
export type LuaScriptLoader = LuaFilterOptions["readFile"];

/** Each conversion owns a fresh VM without host file, process or module APIs. */
export function createLuaFilterCapability(load: LuaScriptLoader | LuaFilterOptions | LuaStreamFilterOptions): FilterCapability {
  const readFile = typeof load === "function" ? load : load?.readFile;
  const readStream = typeof load === "function" ? undefined : load?.readStream;
  if (typeof readFile !== "function" && typeof readStream !== "function") throw new TypeError("A local Lua filter reader is required");
  const reader = typeof load !== "function";
  return {
    supports: request => request.kind === "lua",
    applyJsonStream: (streams,request,context) => applyLuaStream(load,streams,request,context),
    async apply(document, request, context) {
      if (request.kind !== "lua") throw new PandocError("E_CAPABILITY", "convert", "This capability supports Lua filters only");
      context.checkpoint(0);
      let source = readStream ? undefined : await readFile!(request.path, context.signal);
      context.checkpoint();
      if (!readStream) {
        if (!(source instanceof Uint8Array)) throw new PandocError("E_IO", "convert", "Lua filter source must be bytes");
        context.charge("inputBytes", source.byteLength);
        context.charge("retainedBytes", source.byteLength);
        source = new Uint8Array(source);
      }
      const runtime = (await import("./fengari.generated.js")).default as typeof import("fengari");
      context.checkpoint(0);
      const {lua, lauxlib, lualib, to_luastring, to_jsstring} = runtime;
      const state = lauxlib.luaL_newstate();
      let hookFailure: unknown;
      const fail = (code: "E_AST" | "E_UNSUPPORTED_FEATURE", message: string): never => {
        throw new PandocError(code, "convert", message);
      };
      const checked = (status: number, script = false) => {
        if (hookFailure) throw hookFailure;
        if (status !== lua.LUA_OK) throw new PandocError(script && !reader ? "E_IO" : "E_AST", "convert", lua.lua_tojsstring(state, -1) ?? "Lua filter execution failed");
      };
      // Resume the VM from instruction hooks so caller cancellation/yield tasks
      // can run during Lua loops. Keep the same state and stack identities across
      // resumptions, including the rooted runner and returned callback closures.
      const run = async (args: number, results: number, script = false): Promise<void> => {
        const base = lua.lua_gettop(state) - args - 1;
        let status = lua.lua_resume(state, null, args);
        while (status === lua.LUA_YIELD) {
          await context.cooperate(0);
          status = lua.lua_resume(state, null, 0);
        }
        checked(status, script);
        lua.lua_settop(state, base + results);
      };
      const push = (value: unknown, depth = 0): void => {
        context.checkpoint(); context.bound("depth", depth);
        if (!lua.lua_checkstack(state, 4)) fail("E_AST", "Lua stack capacity exceeded");
        if (value === null) {
          lua.lua_newtable(state); lua.lua_pushboolean(state, true); lua.lua_setfield(state, -2, to_luastring("__pandoc_null"));
        } else if (value === undefined) lua.lua_pushnil(state);
        else if (typeof value === "string") lua.lua_pushstring(state, to_luastring(value));
        else if (typeof value === "number") lua.lua_pushnumber(state, value);
        else if (typeof value === "boolean") lua.lua_pushboolean(state, value);
        else if (typeof value === "object") {
          lua.lua_newtable(state);
          for (const [key, child] of Object.entries(value)) {
            context.charge("references", 1); context.charge("retainedBytes", 16);
            push(child, depth + 1);
            if (Array.isArray(value)) lua.lua_rawseti(state, -2, Number(key) + 1);
            else lua.lua_setfield(state, -2, to_luastring(key));
          }
        } else fail("E_AST", "Unsupported Lua input value");
      };
      const read = (depth = 0): unknown => {
        context.checkpoint(); context.bound("depth", depth);
        if (!lua.lua_checkstack(state, 4)) fail("E_AST", "Lua stack capacity exceeded");
        const type = lua.lua_type(state, -1);
        if (type === lua.LUA_TNIL) return undefined;
        if (type === lua.LUA_TBOOLEAN) return lua.lua_toboolean(state, -1);
        if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(state, -1);
        if (type === lua.LUA_TSTRING) {
          const bytes = lua.lua_tolstring(state, -1)!;
          context.charge("retainedBytes", bytes.length * 2);
          const text = to_jsstring(bytes); context.charge("text", text.length); return text;
        }
        if (type !== lua.LUA_TTABLE) return fail("E_AST", "Invalid Lua replacement value");
        lua.lua_getfield(state, -1, to_luastring("__pandoc_null"));
        const isNull = lua.lua_toboolean(state, -1); lua.lua_pop(state, 1);
        if (isNull) return null;
        const entries: [string | number, unknown][] = [];
        lua.lua_pushnil(state);
        while (lua.lua_next(state, -2)) {
          context.charge("references", 1); context.charge("retainedBytes", 16);
          const keyType = lua.lua_type(state, -2);
          if (keyType !== lua.LUA_TSTRING && keyType !== lua.LUA_TNUMBER) fail("E_AST", "Invalid Lua table key");
          const key = keyType === lua.LUA_TNUMBER ? lua.lua_tonumber(state, -2) : to_jsstring(lua.lua_tolstring(state, -2)!);
          entries.push([key, read(depth + 1)]); lua.lua_pop(state, 1);
        }
        if (entries.every(([key]) => typeof key === "number")) {
          const result: unknown[] = [];
          for (const [key, value] of entries) {
            if (!Number.isInteger(key) || Number(key) < 1 || Number(key) > entries.length) fail("E_AST", "Lua lists require consecutive integer keys");
            result[Number(key) - 1] = value;
          }
          return result;
        }
        if (entries.some(([key]) => typeof key !== "string")) fail("E_AST", "Mixed Lua table keys are unsupported");
        const object = Object.fromEntries(entries);
        if (object.t === "MetaMap" && Array.isArray(object.c) && object.c.length === 0) object.c = {};
        return object;
      };
      // Retain parser-owned tuples and sidecars when the Lua result is equal.
      const share = (before: unknown, after: unknown): unknown => {
        context.checkpoint();
        if (before === after) return before;
        if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) return after;
        const result = Array.isArray(after) ? [] : {};
        for (const [key, child] of Object.entries(after)) Object.defineProperty(result, key, {value: share((before as Record<string, unknown>)[key], child), enumerable: true, configurable: true, writable: true});
        return Object.keys(before).length === Object.keys(after).length && Object.entries(result).every(([key, child]) => child === (before as Record<string, unknown>)[key]) ? before : result;
      };
      try {
        for (const [name, open] of [["_G", lualib.luaopen_base], ["string", lualib.luaopen_string], ["table", lualib.luaopen_table], ["math", lualib.luaopen_math], ["utf8", lualib.luaopen_utf8]] as const) {
          lauxlib.luaL_requiref(state, to_luastring(name), open, true); lua.lua_pop(state, 1);
        }
        for (const name of ["dofile", "loadfile", "load", "print", "pcall", "xpcall", "collectgarbage"]) {
          lua.lua_pushnil(state); lua.lua_setglobal(state, to_luastring(name));
        }
        lua.lua_pushstring(state, to_luastring(context.to.split("+")[0]!.split("-")[0]!)); lua.lua_setglobal(state, to_luastring("FORMAT"));
        lua.lua_sethook(state, () => {
          try {context.checkpoint(100);} catch (error) {hookFailure = error; throw error;}
          // Native library calls can invoke Lua across a non-yieldable boundary.
          // Keep their checkpoints without introducing a new Lua runtime error.
          if (lua.lua_isyieldable(state)) lua.lua_yield(state, 0);
        }, lua.LUA_MASKCOUNT, 100);
        lua.lua_pushjsfunction(state, () => {
          try {context.bound("depth", lua.lua_tonumber(state, 1));} catch (error) {hookFailure = error; throw error;}
          return 0;
        });
        lua.lua_setglobal(state, to_luastring("__pandoc_depth"));
        lua.lua_pushjsfunction(state, () => {
          hookFailure = new PandocError("E_AST", "convert", "Lua callback must return an element, list or nil");
          throw hookFailure;
        });
        lua.lua_setglobal(state, to_luastring("__pandoc_ast_error"));
        const bootstrap = to_luastring(luaAst);
        checked(lauxlib.luaL_loadbuffer(state, bootstrap, bootstrap.length, to_luastring("pandoc constructors")));
        await run(0, 0);
        lua.lua_getglobal(state, to_luastring("__pandoc_callbacks"));
        const callbacks = read() as Record<string, boolean>;
        lua.lua_pop(state, 1);
        // Root the runner so scripts cannot replace it through global mutation.
        lua.lua_getglobal(state, to_luastring("__pandoc_run"));
        const runner = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
        if (readStream) {
          let first = true;
          const release = context.onClose?.(async () => {await compilation.catch(() => {});});
          const compilation = Promise.resolve().then(async () => {
            const chunks = readStream(request.path, context.signal);
            const iterator = Symbol.asyncIterator in chunks
              ? chunks[Symbol.asyncIterator]()
              : chunks[Symbol.iterator]();
            let exhausted = false;
            let chunk: Uint8Array = new Uint8Array(0);
            let offset = 0;
            let failure: {reason: unknown} | undefined;
            try {checked(await runtime.loadStream(state, async () => {
              context.checkpoint(0);
              if (offset === chunk.byteLength) {
                const next = await iterator.next();
                exhausted = next.done === true;
                context.checkpoint(0);
                if (next.done) return null;
                if (!(next.value instanceof Uint8Array)) throw new PandocError("E_IO", "convert", "Lua filter source must be bytes");
                chunk = next.value;
                offset = 0;
                if (chunk.byteLength) {
                  if (first && chunk[0] === 27) fail("E_UNSUPPORTED_FEATURE", "Lua bytecode filters are unsupported");
                  first = false;
                }
                context.charge("inputBytes", chunk.byteLength);
              }
              // Borrow only until the next producer pull; the compiler owns a
              // bounded slice even if the source supplies an entire file.
              const end = Math.min(offset + 65536, chunk.byteLength);
              context.charge("retainedBytes", end - offset);
              const owned = new Uint8Array(chunk.subarray(offset, end));
              offset = end;
              await context.cooperate(Math.max(1, owned.byteLength));
              return owned;
            }, to_luastring(request.path)), true);
            } catch (reason) {failure = {reason};}
            try {if (!exhausted) await iterator.return?.();} catch (reason) {failure ??= {reason};}
            if (failure) throw failure.reason;
          });
          try {await compilation;} finally {release?.();}
        } else {
          if (source![0] === 27) fail("E_UNSUPPORTED_FEATURE", "Lua bytecode filters are unsupported");
          checked(lauxlib.luaL_loadbuffer(state, source!, source!.length, to_luastring(request.path)), true);
        }
        await run(0, 1, true);
        const filters: number[] = [];
        const capture = (global = false) => {
          if (!lua.lua_istable(state, -1)) fail("E_UNSUPPORTED_FEATURE", "Expected a Lua filter table");
          // Freeze callback identity before a filter can mutate globals/tables.
          lua.lua_newtable(state);
          lua.lua_pushnil(state);
          while (lua.lua_next(state, -3)) {
            if (lua.lua_type(state, -2) !== lua.LUA_TSTRING) fail("E_UNSUPPORTED_FEATURE", "Invalid Lua filter callback name");
            const name = to_jsstring(lua.lua_tolstring(state, -2)!);
            if (!Object.hasOwn(callbacks, name)) {
              if (!global) fail("E_UNSUPPORTED_FEATURE", `Unsupported Lua filter field: ${name}`);
              lua.lua_pop(state, 1); continue;
            }
            if (!lua.lua_isfunction(state, -1)) fail("E_AST", `Lua ${name} callback must be a function`);
            lua.lua_pushvalue(state, -2); lua.lua_pushvalue(state, -2); lua.lua_settable(state, -5);
            lua.lua_pop(state, 1);
          }
          filters.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
        };
        if (lua.lua_isnil(state, -1)) {lua.lua_pop(state, 1); lua.lua_getglobal(state, to_luastring("_G")); capture(true);}
        else if (lua.lua_istable(state, -1) && lua.lua_rawlen(state, -1) > 0) {
          const count = lua.lua_rawlen(state, -1);
          for (let i = 1; i <= count; i++) {lua.lua_rawgeti(state, -1, i); capture(); lua.lua_pop(state, 1);}
        } else capture();
        lua.lua_pop(state, 1);
        await context.cooperate();
        lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, runner);
        const inputMeta = document.metadata ?? ((document as {meta?: Document["metadata"]}).meta ?? {});
        push({blocks: document.blocks, meta: inputMeta});
        lua.lua_newtable(state);
        for (let i = 0; i < filters.length; i++) {lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, filters[i]!); lua.lua_rawseti(state, -2, i + 1);}
        await run(2, 1, true);
        const result = read() as {blocks: Document["blocks"]; meta: Document["metadata"]};
        await context.cooperate();
        const nextMetadata = share(inputMeta, Array.isArray(result.meta) && !result.meta.length ? {} : result.meta) as Document["metadata"];
        return {...document, ...(Object.hasOwn(document, "meta") && !Object.hasOwn(document, "metadata") ? {meta: nextMetadata} : {}), blocks: share(document.blocks, result.blocks) as Document["blocks"], metadata: nextMetadata};
      } finally {lua.lua_close(state);}
    }
  };
}
