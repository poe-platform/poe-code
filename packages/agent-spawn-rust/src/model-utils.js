import { native } from "./native.js";
export const stripModelNamespace = native.spawnStripModel;

export function normalizeModelOverride(model) {
  if (model !== undefined && model.length > 0 && model.trim().length === 0)
    throw new Error("Model must not be blank.");
  return model;
}
