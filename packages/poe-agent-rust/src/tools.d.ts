import type { NormalizedTool, Tool } from "./types.js";
export declare function normalizeTool(tool: Tool): NormalizedTool;
export declare class ToolRegistry {
  #private;
  register(tool: Tool): void;
  get(name: string): NormalizedTool | undefined;
  getAll(): NormalizedTool[];
  getActiveTools(activeSkills?: string[]): NormalizedTool[];
  copyFrom(registry: ToolRegistry): void;
}
