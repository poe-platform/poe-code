import type {ExplorerEvent} from './explorer-events.js';
import type {DetailCtx,DetailItem} from './explorer-state.js';
export declare const LOADING_INDICATOR_MS = 150;
export declare const DETAIL_DEBOUNCE_MS = 30;
export declare function createDetailJobs(emit: (event: ExplorerEvent) => void): {
  schedule: (rowId: string, token: number, items: (ctx: DetailCtx) => Promise<DetailItem[]>, ctx: DetailCtx) => Promise<void>;
  abort: () => void;
};
