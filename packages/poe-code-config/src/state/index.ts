import os from "node:os";
import { createJobRegistry, type JobRegistry } from "./jobs.js";
import { createTemplateRegistry, type TemplateRegistry } from "./templates.js";
import type { StateFileSystem } from "./fs.js";

export interface StateManager {
  templates: TemplateRegistry;
  jobs: JobRegistry;
}

export async function loadStateManager(homeDir: string = os.homedir()): Promise<StateManager> {
  return {
    templates: createTemplateRegistry(homeDir),
    jobs: createJobRegistry(homeDir)
  };
}

export function createStateManager(homeDir: string, fs?: StateFileSystem): StateManager {
  return {
    templates: createTemplateRegistry(homeDir, fs),
    jobs: createJobRegistry(homeDir, fs)
  };
}

export {
  createJobRegistry,
  type JobEntry,
  type JobListFilter,
  type JobRegistry,
  type JobStatus
} from "./jobs.js";
export {
  createTemplateRegistry,
  type TemplateBackend,
  type TemplateEntry,
  type TemplateRegistry
} from "./templates.js";
export type { StateFileSystem } from "./fs.js";
