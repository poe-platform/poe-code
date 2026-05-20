import { ScreenBuffer } from "../../dashboard/buffer.js";
import type { ExplorerLayout } from "../layout.js";
import type { ActionStateEntry, ExplorerState } from "../state.js";
import { getExplorerStyles } from "../theme.js";

type FooterHint = {
  key: string;
  label: string;
  running: boolean;
  bracketed?: boolean;
};

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
    if (hint.bracketed === false) {
      const text = `${hint.key} ${hint.label}`;
      screen.put(x, y, text, hint.running ? styles.muted : {});
      x += text.length + 2;
      continue;
    }

    screen.put(x, y, `[${hint.key}]`, hint.running ? styles.muted : styles.accent);
    x += hint.key.length + 2;
    screen.put(x, y, ` ${hint.label}`, hint.running ? styles.muted : {});
    x += hint.label.length + 3;
  }
}

function footerHints(state: ExplorerState): FooterHint[] {
  const hints: FooterHint[] = [];

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
  if (hasShiftReorderBindings(state)) {
    hints.push({ key: "⇧↑↓", label: "reorder (within state)", running: false, bracketed: false });
  }
  hints.push({ key: "q", label: "quit", running: false });

  return hints;
}

function hasShiftReorderBindings(state: ExplorerState): boolean {
  const up = state.bindings.keysByTarget.get("builtin:reorderUp") ?? [];
  const down = state.bindings.keysByTarget.get("builtin:reorderDown") ?? [];
  return up.includes("Shift+up") && down.includes("Shift+down");
}

function actionKey(entry: ActionStateEntry, fallback: string): string {
  const key = entry.action?.key;
  if (Array.isArray(key)) {
    return key[0] ?? fallback;
  }
  return key ?? (entry.action?.primary === true ? "Enter" : fallback);
}
