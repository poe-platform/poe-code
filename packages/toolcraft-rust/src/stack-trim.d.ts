export type DebugStackMode = "trim" | "raw";
export declare function enableSourceMaps(): void;
export declare function formatDebugStack(stack: string, mode: DebugStackMode): string;
export declare function trimStack(stack: string): string;
