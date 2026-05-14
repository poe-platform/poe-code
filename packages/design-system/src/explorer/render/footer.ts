import { ScreenBuffer } from "../../dashboard/buffer.js";
import type { ExplorerLayout } from "../layout.js";
import type { ActionStateEntry, ExplorerState } from "../state.js";
import { getExplorerStyles } from "../theme.js";

export function renderFooter(
  state: ExplorerState,
  screen: ScreenBuffer,
  layout: ExplorerLayout
): void {
  const rect = layout.footer;
  const styles = getExplorerStyles();
  screen.clearRect(rect);

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const hints = footerHints(state);
  let x = rect.x + 2;
  const y = rect.y;

  for (const hint of hints) {
    if (x >= rect.x + rect.width) {
      break;
    }
    screen.put(x, y, `[${hint.key}]`, hint.running ? styles.muted : styles.accent);
    x += hint.key.length + 2;
    screen.put(x, y, ` ${hint.label}`, hint.running ? styles.muted : {});
    x += hint.label.length + 3;
  }
}

function footerHints(state: ExplorerState): Array<{ key: string; label: string; running: boolean }> {
  const hints: Array<{ key: string; label: string; running: boolean }> = [];

  if (state.focused === "detail") {
    hints.push({ key: "Tab", label: "focus", running: false });
    hints.push({ key: "Enter", label: "sub", running: false });
  }

  for (const [id, entry] of state.actionState) {
    if (!entry.available || entry.action?.showInFooter === false) {
      continue;
    }
    const key = actionKey(entry, id);
    const label = state.selected.size > 0 && entry.source === "row"
      ? `${entry.label} ${state.selected.size}`
      : entry.label;
    hints.push({ key, label, running: entry.running === true });
  }

  hints.push({ key: "?", label: "help", running: false });
  hints.push({ key: "Ctrl+P", label: "palette", running: false });
  hints.push({ key: "q", label: "quit", running: false });

  return hints;
}

function actionKey(entry: ActionStateEntry, fallback: string): string {
  const key = entry.action?.key;
  if (Array.isArray(key)) {
    return key[0] ?? fallback;
  }
  return key ?? (entry.action?.primary === true ? "Enter" : fallback);
}
