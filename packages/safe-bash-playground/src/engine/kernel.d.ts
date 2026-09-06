declare module "virtual:safe-bash-kernel" {
  export {
    createMemoryFileSystem,
    resolvePath,
    normalizePath,
    readBytes,
    FsError
  } from "safe-bash-engine/safe-bash";
  import { Shell as NativeShell } from "safe-bash-engine/safe-bash";
  import type {
    CommandDefinition,
    ShellExecOptions as NativeShellExecOptions,
    ShellResult
  } from "safe-bash-engine/safe-bash";
  export interface RootShellState {
    readonly cwd: string;
  }
  export interface ShellExecOptions extends NativeShellExecOptions {
    readonly onState?: (state: Readonly<RootShellState>) => void;
    readonly onCwd?: (cwd: string) => void;
  }
  export class Shell extends NativeShell {
    exec(source: string, options?: ShellExecOptions): Promise<ShellResult>;
  }
  export function createAgentCommands(): CommandDefinition[];
}
