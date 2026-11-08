import { native } from "./native.js";
export const SPAWN_MODES = Object.freeze(["yolo", "auto", "edit", "read"]);
export const DEFAULT_SPAWN_MODE = "auto";
export function resolveModeConfig(value) {
  const result = native.spawnModeConfig(JSON.stringify(value));
  if (!Array.isArray(value)) result.env ??= undefined;
  return result;
}
export function resolveAgentModeConfig(config, mode) {
  const result = native.spawnResolveMode(JSON.stringify(config), mode);
  result.env ??= undefined;
  return result;
}
