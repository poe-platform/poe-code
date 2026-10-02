/// <reference types="node" />
import type {RenderPerformanceSnapshot} from "./render-performance.js";
import type {DashboardSubmission} from "./composer.js";
import type {FooterHint} from "./dashboard-footer.js";
import type {Command,DashboardStats,OutputItem} from "./dashboard-types.js";
export type DashboardOptions = {
  title?: string;
  statsTitle?: string;
  keymap?: Partial<Record<Command, string[]>>;
  rightPaneWidth?: number;
  hints?: FooterHint[];
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  appearance?: "panels" | "conversation";
  /** Resolves once the runtime accepts the input; rejection keeps the draft editable. */
  onSubmit?: (submission: DashboardSubmission) => void | Promise<void>;
  /** Observe bounded performance snapshots without forcing idle repaints. */
  onPerformance?: (stats: RenderPerformanceSnapshot) => void;
};

export type Dashboard = {
  start(): void;
  stop(): void;
  appendOutput(item: OutputItem): void;
  updateStats(stats: Partial<DashboardStats>): void;
  onCommand(handler: (cmd: Command) => void): void;
  destroy(): void;
  getPerformance(): RenderPerformanceSnapshot;
};

export declare function createDashboard(opts?: DashboardOptions): Dashboard;
