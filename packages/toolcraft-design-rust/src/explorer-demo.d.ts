import type { ExplorerConfig } from "./explorer-state.js";
type ExplorerDemoMode = "single-detail-mode" | "list-detail-mode";
export interface ExplorerDemoOptions {
    mode: ExplorerDemoMode;
    slowDetail: boolean;
}
export interface BuildExplorerDemoConfigOptions extends ExplorerDemoOptions {
    onReorder?: (orderedIds: string[]) => void | Promise<void>;
}
export declare function parseExplorerDemoOptions(argv?: string[], env?: NodeJS.ProcessEnv): ExplorerDemoOptions;
export declare function buildExplorerDemoConfig(options: BuildExplorerDemoConfigOptions): ExplorerConfig<void>;
export declare function main(): Promise<void>;
export {};
