/** Process transports are unavailable in remote-only runtimes. */
export function spawn(): never {
  throw new Error("Stdio MCP is unavailable in Worker runtimes");
}
