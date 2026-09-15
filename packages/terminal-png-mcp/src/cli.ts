#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { createTerminalPngMcpServer } from "./index.js";

export async function runCli(
  args: string[] = process.argv.slice(2),
  output: Pick<NodeJS.WriteStream, "write"> = process.stderr
): Promise<number> {
  let help: boolean;
  try {
    const { values } = parseArgs({ args, options: { help: { type: "boolean", short: "h" } } });
    help = values.help ?? false;
  } catch (error) {
    output.write(`${error instanceof Error ? error.message : String(error)}\nRun with --help for usage.\n`);
    return 1;
  }
  if (help) {
    output.write("Usage: terminal-png-mcp [options]\n\nServe MCP over stdio.\n\nOptions:\n  -h, --help  Show this help message\n");
    return 0;
  }
  await createTerminalPngMcpServer().listen();
  return 0;
}

let isCli = false;
try {
  isCli = process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  // Imported modules can have an unrelated or missing executable path.
}
if (isCli) {
  process.exitCode = await runCli();
}
