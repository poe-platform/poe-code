export interface InlineNotice {
    level: "info" | "success" | "warning" | "error";
    text: string;
}
export declare function renderNotice(notice: InlineNotice, width: number): string;
/** Notices expire during reads, so an idle terminal needs no repaint timer. */
export declare function createNotices({ capacity, now }: {
    capacity: number;
    now?: () => number;
}): {
    put(id: string, notice: InlineNotice, durationMs?: number): void;
    dismiss(id: string): void;
    list(): InlineNotice[];
};
