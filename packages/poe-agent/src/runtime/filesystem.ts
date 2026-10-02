import { hostProcess } from "#agent-platform";
import { hostEnvironment as os, nativePath as path, createHostFileSystem } from "#agent-platform";
import { createFsBridge, getFsBridgeProvider, type FsBridge } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";

export function agentFsBridge(fs: FileSystem, options: { cwd?: string; root?: string; signal?: AbortSignal } = {}): FsBridge {
  return createFsBridge(fs, { ...options, codec: {
    isEncoding: encoding => encoding === "utf8" || encoding === "utf-8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  } });
}

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
  readonly nodeFs: FsBridge;
  readonly customFs: boolean;
};

export function createAgentRuntime(
  options: AgentOptions & { customFs?: boolean },
  signal: AbortSignal
): AgentRuntime {
  const customFs = options.customFs ?? options.fs !== undefined;
  const paths = customFs ? path.posix : path;
  const cwd = paths.resolve(
    customFs ? "/" : hostProcess.cwd(),
    options.cwd ?? (customFs ? "/" : hostProcess.cwd())
  );
  const fs = options.fs ?? createHostFileSystem();
  return Object.freeze({
    fs,
    cwd,
    homeDir: paths.resolve(cwd, options.homeDir ?? (customFs ? "/" : os.homedir())),
    signal,
    customFs,
    nodeFs: agentFsBridge(fs, { cwd, root: "/", signal })
  });
}

/** Legacy overrides remain supported for host agents; explicit providers cannot be widened. */
export function resolvePluginFileSystem<T>(
  runtime: AgentRuntime | undefined,
  legacy: T | undefined,
  fallback: T
): T | FsBridge {
  if (
    runtime?.customFs &&
    legacy !== undefined &&
    legacy !== runtime.nodeFs &&
    (typeof legacy !== "object" ||
      legacy === null ||
      getFsBridgeProvider(legacy) !== runtime.fs)
  ) {
    throw new Error(
      "Plugin filesystem conflicts with the configured agent filesystem. Remove the per-plugin fs option."
    );
  }
  return runtime?.customFs ? runtime.nodeFs : (legacy ?? runtime?.nodeFs ?? fallback);
}
