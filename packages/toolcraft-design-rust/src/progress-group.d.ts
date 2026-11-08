export interface ProgressItem {
    label: string;
    completed?: number;
    total?: number;
    status?: "running" | "success" | "error";
}
export declare function renderProgressGroup(items: readonly ProgressItem[], width: number): string[];
