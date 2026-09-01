
import { Shell, agentCommands, createMemoryFileSystem } from "../../../src/index.js";
import { type StreamFormatCommandsOptions } from "../../../src/commands/stream-format/index.js";

export function shell(options: StreamFormatCommandsOptions = {}, env: Record<string, string> = { LC_ALL: "C" }): Shell {
  const { replace, ...streamFormat } = options;
  return new Shell({ fs: createMemoryFileSystem(), env }).use(agentCommands({ streamFormat, ...(replace === undefined ? {} : { replace }) }));
}

export const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
export interface NativeCase { readonly args: readonly string[]; readonly input?: string | Uint8Array; readonly locale?: string; readonly failure?: boolean }
