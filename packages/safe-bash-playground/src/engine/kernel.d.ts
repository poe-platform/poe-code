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
  }
  export class Shell extends NativeShell {
    exec(source: string, options?: ShellExecOptions): Promise<ShellResult>;
  }
  export function basicCommands(): CommandDefinition[];
  export function filesystemCommands(): CommandDefinition[];
  export function predicateCommands(): CommandDefinition[];
  export function streamCommands(): CommandDefinition[];
  export function textCommands(): CommandDefinition[];
}
