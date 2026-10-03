import {PandocError} from "./errors.js";
import type {StoredLuaValue} from "./lua-storage.js";

/** A Lua error can carry any value, including a backed binary string. Keep that
 * value retained for the boundary adapter instead of materializing its payload
 * into a JavaScript Error message while the VM is executing. */
export class LuaError extends PandocError {
  constructor(readonly value: StoredLuaValue,readonly level: number) {
    super("E_AST","convert","Lua error");
  }
}
