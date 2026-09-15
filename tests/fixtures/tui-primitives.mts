/** Fake application under test. QA steps live in docs/plans/qa/tui-primitives-qa.md. */
import { createDashboard } from "../../packages/toolcraft-design/src/dashboard/dashboard.js";

import { createTaskTree, renderTaskRows, renderEventGroupRows, createEventGroups, createMetric, createOverlayManager, createCommandRegistry, createNotices, renderProgressGroup, renderNotice } from "../../packages/toolcraft-design/src/primitives.js";

const dashboard = createDashboard({ title: "TUI primitives", statsTitle: "Run", hints: [
  { key: "q", label: "Quit" }, { key: "↑↓", label: "Scroll" }, { key: "F", label: "Follow" },
  { key: "Ctrl+G", label: "FPS" }
] });
const widgets = process.argv.includes("--widgets");
const tree = createTaskTree();
const groups = createEventGroups({ capacity: 10, children: 20 });
const metric = createMetric({ capacity: 20, unit: "ms" });
const overlays = createOverlayManager("output");
const notices = createNotices({ capacity: 3 });
tree.upsert({ id: "run", label: "Pipeline", status: "running" });
tree.upsert({ id: "test", parentId: "run", label: "Tests", status: "running" });
groups.append("Tools", { id: "read", text: "Read source files" });
groups.append("Tools", { id: "error", text: "Retry recovered", error: true });
notices.put("status", { level: "info", text: "Streaming; focus stays in output" });
const commands = createCommandRegistry([
  { id: "group", label: "Toggle group", keys: ["g"], run: () => groups.toggle("Tools") },
  { id: "tree", label: "Toggle task", keys: ["t"], run: () => tree.toggle("run") },
  { id: "overlay", label: "Open overlay", keys: ["o"], run: () => overlays.open("palette") },
  { id: "escape", label: "Close overlay", keys: ["\x1b"], run: () => { overlays.close(); } }
]);
function paintWidgets() {
  const rows = [
    ...renderTaskRows(tree.rows(0, 5), 60),
    ...renderEventGroupRows(groups.rows(0, 5), 60),
    ...renderProgressGroup([{ label: "Upload", completed: count % 100, total: 100 }, { label: "Agent working" }], 60),
    metric.render(60), ...notices.list().map(notice => renderNotice(notice, 60)),
    `Focus: ${overlays.focus()} · g group / t task / o overlay / Esc close`
  ];
  dashboard.appendOutput({ id: "widgets", kind: "tool", text: rows.join("\n"), ts: Date.now() });
}
function handleInput(data: Buffer) { if (widgets && commands.dispatch(data.toString())) paintWidgets(); }
process.stdin.on("data", handleInput);
let count = 0;
dashboard.updateStats({ status: "running", currentAction: "Render performance · Ctrl+G toggles diagnostics" });
dashboard.start();
const timer = setInterval(() => {
  if (widgets) { count++; metric.push(2 + count % 7); paintWidgets(); return; }
  for (let index = 0; index < 100; index++) dashboard.appendOutput({ kind: "tool", text: `Fake event ${count++} · streaming smoothly`, ts: Date.now() });
}, widgets ? 100 : 16);
dashboard.onCommand(command => {
  if (command !== "quit" && command !== "forceQuit") return;
  clearInterval(timer);
  process.stdin.off("data", handleInput); overlays.dispose();
  const stats = dashboard.getPerformance();
  dashboard.destroy();
  console.log("RENDER_PERFORMANCE " + JSON.stringify(stats));
});
