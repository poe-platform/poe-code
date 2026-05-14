import { ScreenBuffer } from "../../dashboard/buffer.js";
import type { ExplorerState } from "../state.js";
import { getExplorerStyles, type ExplorerStyles } from "../theme.js";

type ExplorerCellStyle = ExplorerStyles["accent"];

export function renderModal(state: ExplorerState, screen: ScreenBuffer): void {
  if (state.modal === null || screen.width <= 0 || screen.height <= 0) {
    return;
  }

  const width = Math.min(screen.width - 2, Math.max(34, Math.floor(screen.width * 0.62)));
  const height = Math.min(screen.height - 2, modalHeight(state));
  const x = Math.max(0, Math.floor((screen.width - width) / 2));
  const y = Math.max(0, Math.floor((screen.height - height) / 2));
  const styles = getExplorerStyles();

  drawBox(screen, x, y, width, height, title(state), styles.borderFocused);
  const lines = modalLines(state);
  for (let row = 0; row < Math.min(lines.length, height - 2); row += 1) {
    screen.put(x + 2, y + 1 + row, fit(lines[row]!, width - 4), row === 1 ? styles.accent : {});
  }
}

function modalLines(state: ExplorerState): string[] {
  if (state.modal?.kind === "help") {
    return [
      "Navigation",
      "  ↑ ↓ k j       move cursor",
      "  Tab           cycle panes",
      "  /             filter",
      "  ?             help",
      "  q             quit"
    ];
  }

  if (state.modal?.kind === "confirm") {
    return [
      state.modal.action.destructive ? "Destructive action" : "Confirm action",
      `${labelFor(state.modal.action)} ${state.modal.rows.length} row(s)?`,
      "Enter confirms · Esc cancels"
    ];
  }

  if (state.modal?.kind === "palette") {
    return [
      `Query: ${state.modal.query}`,
      "delete",
      "archive",
      "edit",
      "open"
    ];
  }

  return [];
}

function title(state: ExplorerState): string {
  if (state.modal?.kind === "help") {
    return "Keybindings";
  }
  if (state.modal?.kind === "confirm") {
    return "Confirm";
  }
  return "Command Palette";
}

function modalHeight(state: ExplorerState): number {
  return Math.max(5, modalLines(state).length + 2);
}

function drawBox(
  screen: ScreenBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
  boxTitle: string,
  style: ExplorerCellStyle
): void {
  screen.clearRect({ x, y, width, height });
  const titleSegment = `─ ${boxTitle} `;
  screen.put(x, y, `╭${titleSegment}${"─".repeat(Math.max(0, width - titleSegment.length - 2))}╮`, style);
  for (let row = 1; row < height - 1; row += 1) {
    screen.put(x, y + row, "│", style);
    screen.put(x + width - 1, y + row, "│", style);
  }
  screen.put(x, y + height - 1, `╰${"─".repeat(Math.max(0, width - 2))}╯`, style);
}

function labelFor(action: { label: string | (() => string) }): string {
  return typeof action.label === "function" ? action.label() : action.label;
}

function fit(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}
