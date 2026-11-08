import type {ScreenBuffer} from "./dashboard-buffer.js";
import type {ComposerState} from "./composer.js";
import type {DashboardStats,OutputItem,Rect} from "./dashboard-types.js";
import type {FooterHint} from "./dashboard-footer.js";
export type RunViewOptions = {title: string; stats: DashboardStats; output: OutputItem[]; scrollOffset: number; composer?: ComposerState; submitting?: boolean; showQueue?: boolean; showDetails?: boolean; workOffset?: number; feedback?: string; hints?: FooterHint[]; now?: number};
export declare function renderRunView(buffer: ScreenBuffer, options: RunViewOptions): {scrollOffset: number; outputRect: Rect; workOffset: number; cursor?: {x: number; y: number}};
