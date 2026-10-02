import type {DashboardState, DashboardStats, OutputItem} from "./dashboard-types.js";
export type DashboardStore = {
  getState(): DashboardState;
  appendOutput(item: OutputItem): void;
  updateStats(partial: Partial<DashboardStats>): void;
  onChange(handler: () => void): () => void;
};
export declare function createStore(): DashboardStore;
