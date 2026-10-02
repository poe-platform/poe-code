export interface TaskNode {
    id: string;
    parentId?: string;
    label: string;
    status: "pending" | "running" | "success" | "error";
    durationMs?: number;
}
export declare function createTaskTree({ capacity }?: {
    capacity?: number;
}): {
    upsert(node: TaskNode): void;
    remove(id: string): void;
    toggle(id: string): void;
    rows(offset: number, height: number): (TaskNode & {
        depth: number;
        collapsed: boolean;
    })[];
};
export declare function renderTaskRows(rows: readonly (TaskNode & {
    depth: number;
    collapsed: boolean;
})[], width: number): string[];
