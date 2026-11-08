import type {Row} from "./explorer-state.js";
export interface FilterMatch {
  index: number;
  score: number;
  positions: number[];
}
export interface FilterRowsOptions {
  caseSensitive?: boolean;
}
export declare function filterRows(query: string, rows: readonly Row[], opts?: FilterRowsOptions): FilterMatch[];
