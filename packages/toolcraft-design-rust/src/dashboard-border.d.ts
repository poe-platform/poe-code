import type {ScreenBuffer} from "./dashboard-buffer.js";
import type {DashboardLayout} from "./dashboard-layout.js";
import type {CellStyle} from "./dashboard-types.js";
export type BorderOptions = {leftTitle?: string; rightTitle?: string; style: CellStyle};
export declare function renderBorder(buffer: ScreenBuffer, layout: DashboardLayout, opts: BorderOptions): void;
