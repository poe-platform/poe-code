declare module "virtual:safe-bash-kernel" {
  export { withFileSystemQuota } from "@poe-code/safe-fs/core";
  export {
    createMemoryFileSystem,
    resolvePath,
    normalizePath,
    readBytes,
    FsError
  } from "virtual-bash";
  import { Shell as NativeShell } from "virtual-bash";
  import type {
    ShellExecOptions as NativeShellExecOptions,
    ShellResult
  } from "virtual-bash";
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
  export { createAgentCommands } from "virtual-bash";
  export { createNodeRegexProvider as createWorkerRegexProvider } from "virtual-bash/node";
}
