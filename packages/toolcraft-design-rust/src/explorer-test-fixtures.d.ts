import { ScreenBuffer } from "./dashboard-buffer.js";
import { type DetailItem, type ExplorerState, type Row } from "./explorer-state.js";
export declare function renderStateSnapshot(state: ExplorerState): string;
export declare function dumpScreen(screen: ScreenBuffer): string;
export declare function fixtureState(overrides?: Partial<ExplorerState>): ExplorerState;
export declare function fixtureRows(): Row[];
export declare function singleDetailItem(): DetailItem;
export declare function listDetailItems(): DetailItem[];
