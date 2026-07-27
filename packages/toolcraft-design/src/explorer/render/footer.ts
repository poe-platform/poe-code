import type { ScreenSurface as ScreenBuffer } from "../../screen/screen.js";
import type { ExplorerLayout } from "../layout.js";
import type { ActionStateEntry, ExplorerState } from "../state.js";
import { getExplorerStyles } from "../theme.js";
import { cellWidth, fitToWidth } from "./text.js";

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
  const endX = rect.x + rect.width;

  for (const hint of hints) {
    if (x >= endX) {
      break;
    }
    if (hint.bracketed === false) {
      const text = `${hint.key} ${hint.label}`;
      x += putFooterText(screen, x, y, endX, text, hint.running ? styles.muted : {}) + 2;
      continue;
    }

    const keyText = `[${hint.key}]`;
    const keyWidth = putFooterText(screen, x, y, endX, keyText, hint.running ? styles.muted : styles.accent);
    x += keyWidth;
    if (keyWidth < cellWidth(keyText) || x >= endX) {
      break;
    }

    x += putFooterText(screen, x, y, endX, ` ${hint.label}`, hint.running ? styles.muted : {}) + 2;
  }
}

function putFooterText(
  screen: ScreenBuffer,
  x: number,
  y: number,
  endX: number,
  text: string,
  style = {}
): number {
  const remaining = Math.max(0, endX - x);
  const fitted = fitToWidth(text, remaining, x);
  screen.put(x, y, fitted, style);
  return cellWidth(fitted, x);
}

function footerHints(state: ExplorerState): FooterHint[] {
  if (state.modal?.kind === "input") {
    return [
      { key: "Enter", label: "submit", running: false },
      { key: "Esc", label: "cancel", running: false }
    ];
  }

  if (state.modal?.kind === "confirm") {
    return [
      { key: "Y/Enter", label: state.modal.confirmLabel, running: false },
      { key: "N/Esc", label: state.modal.cancelLabel, running: false }
    ];
  }

  const hints: FooterHint[] = [];

  if (state.focused === "detail") {
    hints.push({ key: "Tab", label: "focus", running: false });
  }

  hints.push({ key: "Enter", label: "actions", running: false });

  for (const [id, entry] of state.actionState) {
    if (!entry.available || entry.action?.showInFooter === false) {
      continue;
    }
    const key = actionKey(entry, id);
    const label = state.multiSelect && state.selected.size > 0 && entry.source === "row"
      ? `${entry.label} ${state.selected.size}`
      : entry.label;
    hints.push({ key, label, running: entry.running === true });
  }

  hints.push({ key: "Ctrl+P", label: "palette", running: false });
  if (hasShiftReorderBindings(state)) {
    hints.push({ key: "⇧↑↓", label: "reorder (within state)", running: false, bracketed: false });
  }
  hints.push({ key: "Esc", label: "clear/quit", running: false });
  if (state.selected.size > 0) hints.push({ key: `${state.selected.size}`, label: "selected", running: false, bracketed: false });

  return hints;
}

function hasShiftReorderBindings(state: ExplorerState): boolean {
  const up = state.bindings.keysByTarget.get("builtin:reorderUp") ?? [];
  const down = state.bindings.keysByTarget.get("builtin:reorderDown") ?? [];
  return up.includes("Shift+up") && down.includes("Shift+down");
}

function actionKey(entry: ActionStateEntry, fallback: string): string {
  if (entry.action?.accelerator !== undefined) return `Ctrl+${entry.action.accelerator.toUpperCase()}`;
  const key = entry.action?.key;
  if (Array.isArray(key)) {
    return key[0] ?? fallback;
  }
  return key ?? (entry.action?.primary === true ? "Enter" : fallback);
}
