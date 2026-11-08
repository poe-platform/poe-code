import type { CallToolResult } from "tiny-stdio-mcp-server";

const mcpResultSymbol = Symbol.for("toolcraft.mcp-result");

export function asMCPResult<TResult extends CallToolResult>(result: TResult): TResult {
  if (result === null || typeof result !== "object" || Array.isArray(result) || !Array.isArray(result.content)) {
    throw new TypeError("MCP results must contain a content array.");
  }
  return Object.defineProperty({ ...result }, mcpResultSymbol, { value: true });
}

export function isMCPResult(value: unknown): value is CallToolResult {
  return value !== null && typeof value === "object" && Reflect.get(value, mcpResultSymbol) === true;
}
