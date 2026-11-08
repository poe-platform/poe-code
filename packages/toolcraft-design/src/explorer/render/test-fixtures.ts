import { ScreenBuffer, cellToAnsi } from "../../dashboard/buffer.js";
import { filterRows } from "../filter.js";
import { computeExplorerLayout } from "../layout.js";
import { createInitialState, REGION_ALL, type Action, type DetailItem, type ExplorerState, type Row } from "../state.js";
import { renderExplorer } from "./index.js";

export function renderStateSnapshot(state: ExplorerState): string {
  const screen = new ScreenBuffer(state.size.cols, state.size.rows);
  renderExplorer(state, screen);
  return dumpScreen(screen).split("\n").map((line) => line.trimEnd()).join("\n");
}

export function dumpScreen(screen: ScreenBuffer): string {
  const lines: string[] = [];
  for (let y = 0; y < screen.height; y += 1) {
    let line = "";
    for (let x = 0; x < screen.width; x += 1) {
      line += cellToAnsi(screen.get(x, y));
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function fixtureState(overrides: Partial<ExplorerState> = {}): ExplorerState {
  const rows = overrides.rows ?? fixtureRows();
  const filter = overrides.filter ?? "";
  const size = overrides.size ?? { cols: 100, rows: 14 };
  const config = {
    title: overrides.title ?? "Plans",
    rows: async () => rows,
    detail: {
      items: async () => []
    },
    actions: fixtureActions(),
    multiSelect: true,
    emptyHint: "No plans"
  };
  const state = createInitialState(config, size);
  state.rows = rows;
  state.filter = filter;
  const matches = filterRows(filter, rows);
  state.filtered = matches.map((match) => match.index);
  state.matchPositions = new Map(matches.map((match) => [match.index, match.positions]));
  state.cursor = overrides.cursor ?? 0;
  state.detail = overrides.detail ?? {
    rowId: rows[0]?.id ?? null,
    items: [singleDetailItem()],
    cursor: 0,
    scroll: 0,
    token: 1,
    loading: false
  };
  state.selected = overrides.selected ?? new Set(["27", "24"]);
  state.focused = overrides.focused ?? "list";
  state.modal = overrides.modal ?? null;
  state.toast = overrides.toast ?? null;
  state.dirty = overrides.dirty ?? REGION_ALL;
  state.layout = computeExplorerLayout(size).mode;

  for (const [key, value] of Object.entries(overrides)) {
    (state as unknown as Record<string, unknown>)[key] = value;
  }

  return state;
}

export function fixtureRows(): Row[] {
  return [
    {
      id: "27",
      title: "Explorer TUI library",
      subtitle: "2d · kjopek · design-system",
      badge: { text: "active", tone: "success" },
      group: "Current"
    },
    {
      id: "26",
      title: "ACP telemetry converters",
      subtitle: "3d · kjopek · acp",
      badge: { text: "draft", tone: "warning" },
      group: "Current"
    },
    {
      id: "25",
      title: "Maestro",
      subtitle: "5d · kjopek · pipeline",
      group: "Backlog"
    },
    {
      id: "24",
      title: "Tasks board sync",
      subtitle: "1w · kjopek · superintendent",
      badge: { text: "blocked", tone: "error" },
      group: "Backlog"
    }
  ];
}

export function singleDetailItem(): DetailItem {
  return {
    id: "body",
    render: () => [
      "# Explorer TUI library",
      "",
      "A reusable list + detail + actions explorer component.",
      "",
      "## What we're building",
      "A generic three-region explorer TUI."
    ].join("\n")
  };
}

export function listDetailItems(): DetailItem[] {
  return [
    {
      id: "thread-1",
      title: "packages/auth/src/refresh.ts:42",
      subtitle: "kjopek · requested changes",
      badge: { text: "fix", tone: "error" },
      render: () => "The lock is released before the await."
    },
    {
      id: "thread-2",
      title: "packages/auth/src/refresh.ts:88",
      subtitle: "nit",
      badge: { text: "nit", tone: "info" },
      render: () => "Rename `t` to `token` for readability."
    }
  ];
}

function fixtureActions(): Array<Action<unknown>> {
  return [
    {
      id: "edit",
      label: "edit",
      accelerator: "e",
      handler: () => undefined,
      showInFooter: true
    },
    {
      id: "archive",
      label: "archive",
      accelerator: "a",
      handler: () => undefined,
      showInFooter: true
    },
    {
      id: "delete",
      label: "delete",
      handler: () => undefined,
      destructive: true,
      showInFooter: true
    },
    {
      id: "open",
      label: "open",
      handler: () => undefined,
      primary: true,
      showInFooter: true
    }
  ];
}
