import { ScreenBuffer, cellToAnsi } from "./buffer.js";
import { renderBorder } from "./components/border.js";
import { defaultHints, renderFooter } from "./components/footer.js";
import { renderOutputPane } from "./components/output-pane.js";
import { renderStatsPane } from "./components/stats-pane.js";
import { computeDashboardLayout } from "./layout.js";
import type { DashboardStats, OutputItem } from "./types.js";

const SNAPSHOT_WIDTH = 80;
const SNAPSHOT_HEIGHT = 20;
const RIGHT_PANE_WIDTH = 25;

export type SnapshotOptions = {
  width?: number;
  height?: number;
  title?: string;
  statsTitle?: string;
  items?: OutputItem[];
  stats?: DashboardStats;
};

export function renderDashboardSnapshot(opts: SnapshotOptions = {}): string {
  const width = opts.width ?? SNAPSHOT_WIDTH;
  const height = opts.height ?? SNAPSHOT_HEIGHT;
  const title = opts.title ?? "Agent Output";
  const statsTitle = opts.statsTitle ?? "Stats";
  const items = opts.items ?? defaultItems();
  const stats = opts.stats ?? defaultStats();

  const layout = computeDashboardLayout({
    totalWidth: width,
    totalHeight: height,
    rightPaneWidth: RIGHT_PANE_WIDTH
  });

  const buffer = new ScreenBuffer(width, height);

  renderBorder(buffer, layout, {
    leftTitle: title,
    rightTitle: statsTitle,
    style: { dim: true }
  });
  renderOutputPane(buffer, layout.leftPane, {
    items,
    scrollOffset: 0,
    autoFollow: true
  });
  renderStatsPane(buffer, layout.rightPane, stats);
  renderFooter(buffer, layout.footer, defaultHints());

  return bufferToAnsi(buffer);
}

function bufferToAnsi(buffer: ScreenBuffer): string {
  const lines: string[] = [];

  for (let y = 0; y < buffer.height; y += 1) {
    let line = "";
    for (let x = 0; x < buffer.width; x += 1) {
      line += cellToAnsi(buffer.get(x, y));
    }
    lines.push(line);
  }

  return lines.join("\n");
}

function defaultItems(): OutputItem[] {
  const now = Date.now();
  return [
    { kind: "info", text: "Analyzing repository state", ts: now },
    { kind: "tool", text: "Running npm test -- --runInBand", ts: now + 500 },
    { kind: "success", text: "Generated provider config", ts: now + 1000 },
    { kind: "status", text: "Streaming model response", ts: now + 1500 },
    { kind: "info", text: "Inspecting agent configuration", ts: now + 2000 },
    { kind: "tool", text: "Executing npm run lint:types", ts: now + 2500 },
    { kind: "error", text: "Retrying transient network request", ts: now + 3000 },
    { kind: "success", text: "Updated dashboard layout", ts: now + 3500 },
    { kind: "info", text: "Collecting recent command output", ts: now + 4000 },
    { kind: "status", text: "Waiting for follow-up task", ts: now + 4500 }
  ];
}

function defaultStats(): DashboardStats {
  return {
    status: "running",
    iterations: 5,
    tokensIn: 685,
    tokensOut: 445,
    elapsedMs: 5000,
    currentAction: "Executing tool call"
  };
}
