import {PandocError} from "./errors.js";
import type {StoredLuaValue,LuaReference} from "./lua-storage.js";

/** A Lua error can carry any value, including a backed binary string. Keep that
 * value retained for the boundary adapter instead of materializing its payload
 * into a JavaScript Error message while the VM is executing. */
export class LuaError extends PandocError {
  scriptFailure = false;
  source?: LuaReference;
  line?: number;
  constructor(readonly value: StoredLuaValue,readonly level: number,code:"E_AST" | "E_UNSUPPORTED_FEATURE"="E_AST") {
    super(code,"convert","Lua error");
  }
}
