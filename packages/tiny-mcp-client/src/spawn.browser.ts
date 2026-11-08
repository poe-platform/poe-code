/** Portable hosts can supply a process adapter through StdioTransportOptions.spawn. */
export const spawn: typeof import("node:child_process").spawn = () => {
  throw new TypeError("This host requires an explicit MCP process adapter; use HTTP or supply spawn.");
};
