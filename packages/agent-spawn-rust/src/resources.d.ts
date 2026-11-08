import type { BridgeManifest } from "./skills/index.js";
import type { BridgeHookManifest } from "./hooks/bridge-hooks.js";
export interface BridgedRunManifest {
  skills?: BridgeManifest;
  hooks?: BridgeHookManifest;
}
export interface HookBridgeOptions {
  from: string;
  strategy?: "auto" | "symlink" | "transform";
  scope?: "project" | "user" | "merged";
}
export declare function bridgeResourcesForRun(
  agentId: string,
  cwd: string,
  skills: string[] | undefined,
  hooks: HookBridgeOptions | undefined
): BridgedRunManifest | undefined;
export declare function cleanupResourcesForRun(manifest: BridgedRunManifest | undefined): void;
