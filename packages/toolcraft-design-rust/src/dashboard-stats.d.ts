import type {ScreenBuffer} from "./dashboard-buffer.js";
import type {DashboardStats,Rect} from "./dashboard-types.js";
import type {VisualLine} from "./dashboard-output.js";
export {formatElapsed} from "./dashboard-elapsed.js";
export declare function formatNumber(n: number): string;
export declare function statsToLines(stats: DashboardStats, width: number): VisualLine[];
export declare function renderStatsPane(buffer: ScreenBuffer, rect: Rect, stats: DashboardStats): void;
export declare function renderCompactStatsPane(buffer: ScreenBuffer, rect: Rect, stats: DashboardStats): void;
