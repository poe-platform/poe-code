import type { ExplorerConfig } from "./state.js";

export function runExplorer<R = void>(_config: ExplorerConfig<R>): Promise<R | null> {
  throw new Error("not implemented");
}
