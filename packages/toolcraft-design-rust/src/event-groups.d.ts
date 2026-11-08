export interface GroupEvent {
    id: string;
    text: string;
    error?: boolean;
}
export interface EventGroupRow extends GroupEvent {
    groupId: string;
    header?: boolean;
    expanded?: boolean;
}
export declare function createEventGroups({ capacity, children }: {
    capacity: number;
    children: number;
}): {
    append(groupId: string, event: GroupEvent): void;
    toggle(groupId: string): void;
    rows(offset: number, height: number): EventGroupRow[];
};
export declare function renderEventGroupRows(rows: readonly EventGroupRow[], width: number): string[];
