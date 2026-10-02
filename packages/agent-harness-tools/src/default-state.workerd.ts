import type { StateManager } from "@poe-code/poe-code-config/core";
export function createStateManager(_homeDir: string): StateManager {
  throw new Error("Command execution requires an injected state manager in this runtime.");
}
