import type {DashboardStats,OutputItem} from "./dashboard-types.js";
export type SnapshotOptions = {
  width?: number;
  height?: number;
  title?: string;
  statsTitle?: string;
  items?: OutputItem[];
  stats?: DashboardStats;
};
export declare function renderDashboardSnapshot(opts?: SnapshotOptions): string;
