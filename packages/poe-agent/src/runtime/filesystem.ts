import * as hostFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createHostFileSystem,
  createNodeFsBridge,
  getNodeFsBridgeProvider,
  type FileSystem,
  type NodeFsImplementation
} from "@poe-code/safe-fs";

export type AgentOptions = {
  fs?: FileSystem;
  cwd?: string;
  homeDir?: string;
};

export type AgentRuntime = {
  readonly fs: FileSystem;
  readonly cwd: string;
  readonly homeDir: string;
  readonly signal: AbortSignal;
  readonly nodeFs: NodeFsImplementation;
  readonly customFs: boolean;
};

export function createAgentRuntime(
  options: AgentOptions & { customFs?: boolean },
  signal: AbortSignal
): AgentRuntime {
  const customFs = options.customFs ?? options.fs !== undefined;
  const paths = customFs ? path.posix : path;
  const cwd = paths.resolve(
    customFs ? "/" : process.cwd(),
    options.cwd ?? (customFs ? "/" : process.cwd())
  );
  const fs = options.fs ?? createHostFileSystem();
  return Object.freeze({
    fs,
    cwd,
    homeDir: paths.resolve(cwd, options.homeDir ?? (customFs ? "/" : os.homedir())),
    signal,
    customFs,
    nodeFs: customFs ? createNodeFsBridge(fs, { cwd, root: "/", signal }) : hostFs
  });
}

/** Legacy overrides remain supported for host agents; explicit providers cannot be widened. */
export function resolvePluginFileSystem<T>(
  runtime: AgentRuntime | undefined,
  legacy: T | undefined,
  fallback: T
): T | NodeFsImplementation {
  if (
    runtime?.customFs &&
    legacy !== undefined &&
    legacy !== runtime.nodeFs &&
    (typeof legacy !== "object" ||
      legacy === null ||
      getNodeFsBridgeProvider(legacy) !== runtime.fs)
  ) {
    throw new Error(
      "Plugin filesystem conflicts with the configured agent filesystem. Remove the per-plugin fs option."
    );
  }
  return runtime?.customFs ? runtime.nodeFs : (legacy ?? runtime?.nodeFs ?? fallback);
}
