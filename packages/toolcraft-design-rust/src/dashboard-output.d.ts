import type {ScreenBuffer} from "./dashboard-buffer.js";
import type {CellStyle,OutputItem,Rect} from "./dashboard-types.js";
import type {StyledSegment} from "./dashboard-ansi.js";
export type VisualLine = {text: string; style: CellStyle; prefix: string; prefixStyle: CellStyle; segments?: StyledSegment[]};
export declare function computeVisualLines(items: OutputItem[], width: number, preformatted?: boolean): VisualLine[];
export declare function renderOutputPane(buffer: ScreenBuffer, rect: Rect, items: OutputItem[], scrollOffset?: number, options?: {conversation?: boolean; details?: boolean; now?: number}): number;
