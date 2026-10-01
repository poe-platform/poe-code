import { createRequire } from "node:module";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const mcpResultSymbol = Symbol.for("toolcraft.mcp-result");
const host = {
  isArray: protect((value) => Array.isArray(value)),
  contentIsArray: protect((value) => Array.isArray(value.content)),
  invalid: protect(() => {
    throw new TypeError("MCP results must contain a content array.");
  }),
  copyAndMark: protect((value) => Object.defineProperty({ ...value }, mcpResultSymbol, { value: true })),
  marker: protect((value) => Reflect.get(value, mcpResultSymbol))
};

export function asMCPResult(result) {
  return callNative(native.markMcpResult, result, host);
}

export function isMCPResult(value) {
  return callNative(native.isMcpResult, value, host);
}
