import type {ScreenBuffer} from "./dashboard-buffer.js";
import type {DashboardStats,Rect} from "./dashboard-types.js";
export type FooterHint = {key: string; label: string};
export declare function defaultHints(): FooterHint[];
export declare function renderFooter(buffer: ScreenBuffer, rect: Rect, hints: FooterHint[], session?: DashboardStats["session"]): void;
