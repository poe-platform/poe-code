import { ScreenBuffer, cellToAnsi, diff } from "../dashboard/buffer.js";
import { createTerminalDriver, type TerminalDriver } from "../dashboard/terminal.js";
import { type ActionRuntimeHandles } from "./actions.js";
import { type Effect, type ExplorerEvent } from "./events.js";
import { createDetailJobs } from "./jobs.js";
import { computeExplorerLayout } from "./layout.js";
import { renderExplorer } from "./render/index.js";
import { step } from "./reducer.js";
import {
  createInitialState,
  REGION_ALL,
  REGION_MODAL,
  REGION_TOAST,
  type Action,
  type ExplorerConfig,
  type ExplorerState,
  type Row,
  type Tone
} from "./state.js";

const TOAST_MS = 2500;

export async function runExplorer<R = void>(config: ExplorerConfig<R>): Promise<R | null> {
  if (process.stdout.isTTY !== true) {
    throw new Error("explorer requires a TTY");
  }

  const driver = createTerminalDriver();
  const runtime = new ExplorerRuntime(config, driver);
  return runtime.run();
}

class ExplorerRuntime<R> {
  private state: ExplorerState;
  private previousBuffer = new ScreenBuffer(0, 0);
  private readonly detailJobs;
  private readonly runtimeHandles: ActionRuntimeHandles;
  private readonly pendingEffects = new Set<Promise<void>>();
  private unsubscribeKeypress: (() => void) | undefined;
  private unsubscribeResize: (() => void) | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private settle:
    | { resolve: (value: R | null) => void; reject: (error: unknown) => void }
    | undefined;

  constructor(
    private readonly config: ExplorerConfig<R>,
    private readonly driver: TerminalDriver
  ) {
    this.state = createInitialState(config, driver.getSize());
    this.detailJobs = createDetailJobs((event) => {
      this.dispatch(event);
    });
    this.runtimeHandles = {
      refresh: async () => {
        await this.refreshRowsFromSource();
      },
      suspendAnd: async (fn) => this.suspendAnd(fn),
      toast: (msg, tone) => {
        this.showToast(msg, tone);
      },
      confirm: async (prompt) => this.confirm(prompt),
      exit: (after) => {
        this.exit(null, after);
      }
    };
  }

  run(): Promise<R | null> {
    return new Promise<R | null>((resolve, reject) => {
      this.settle = { resolve, reject };

      try {
        this.startTerminal();
        this.render();
        this.loadRows().catch((error) => {
          this.fail(error);
        });
      } catch (error) {
        this.fail(error);
      }
    });
  }

  private startTerminal(): void {
    this.driver.enterRawMode();
    this.driver.enterAltScreen();
    this.driver.disableLineWrap();
    this.driver.hideCursor();

    this.unsubscribeKeypress = this.driver.onKeypress((key) => {
      this.dispatch({ type: "key", key });
    });
    this.unsubscribeResize = this.driver.onResize(() => {
      const size = this.driver.getSize();
      this.dispatch({ type: "resize", cols: size.cols, rows: size.rows });
    });
  }

  private async loadRows(): Promise<void> {
    const rows = await this.config.rows();
    this.dispatch({ type: "rowsLoaded", rows });
  }

  private async refreshRowsFromSource(): Promise<void> {
    await this.config.refresh?.();
    await this.loadRows();
  }

  private dispatch(event: ExplorerEvent): void {
    if (this.stopped) {
      return;
    }

    const previousState = this.state;
    const next = step(this.state, event, this.runtimeHandles);
    this.state = next.state;
    this.render();
    this.applyEffects(next.effects, previousState);
  }

  private applyEffects(effects: Effect[], previousState: ExplorerState): void {
    for (const effect of effects) {
      if (effect.type === "renderDetail") {
        this.renderDetail(effect.rowId);
        continue;
      }

      if (effect.type === "persistOrder") {
        this.track(this.persistOrder(effect.orderedIds, previousState.rows));
        continue;
      }

      if (effect.type === "suspend") {
        this.track(this.runActionEffect(effect));
        continue;
      }

      if (effect.type === "exit") {
        this.exit(effect.result as R | null, effect.after);
      }
    }
  }

  private renderDetail(rowId: string): void {
    const row = this.state.rows.find((candidate) => candidate.id === rowId);
    if (row === undefined) {
      return;
    }

    const layout = computeExplorerLayout({
      cols: this.state.size.cols,
      rows: this.state.size.rows,
      detailHidden: this.state.layout === "narrow-list-only" || this.state.layout === "too-narrow"
    });

    void this.detailJobs.schedule(rowId, (ctx) => this.config.detail.items(row, ctx), {
      width: layout.detail.width,
      height: layout.detail.height,
      row,
      signal: new AbortController().signal
    });
  }

  private async persistOrder(orderedIds: string[], previousRows: Row[]): Promise<void> {
    try {
      await this.config.reorder?.onReorder(orderedIds);
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : "Could not persist order", "error");
      this.dispatch({ type: "rowsLoaded", rows: previousRows });
    }
  }

  private async runActionEffect(effect: Extract<Effect, { type: "suspend" }>): Promise<void> {
    try {
      const value = await effect.fn();
      this.dispatch(effect.resumeWith(value));
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : "Action failed", "error");
      this.dispatch(effect.resumeWith(error));
    }
  }

  private async suspendAnd<T>(fn: () => Promise<T>): Promise<T> {
    this.driver.exitAltScreen();
    this.driver.enableLineWrap();
    this.driver.showCursor();
    this.driver.exitRawMode();

    try {
      return await fn();
    } finally {
      if (!this.stopped) {
        this.driver.enterRawMode();
        this.driver.enterAltScreen();
        this.driver.disableLineWrap();
        this.driver.hideCursor();
        const size = this.driver.getSize();
        this.dispatch({
          type: "suspendResumed",
          value: null,
          emit: { type: "resize", cols: size.cols, rows: size.rows }
        });
      }
    }
  }

  private confirm(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const action: Action<unknown> = {
        id: "__confirm__",
        label: prompt,
        handler: () => undefined
      };
      const row = this.currentRow();
      this.state = {
        ...this.state,
        modal: {
          kind: "confirm",
          action,
          rows: row === undefined ? [] : [row],
          resolver: resolve
        },
        dirty: REGION_MODAL
      };
      this.render();
    });
  }

  private showToast(message: string, tone: Tone = "info"): void {
    if (this.stopped) {
      return;
    }

    if (this.toastTimer !== undefined) {
      clearTimeout(this.toastTimer);
    }

    this.state = {
      ...this.state,
      toast: { message, tone, expiresAt: Date.now() + TOAST_MS },
      dirty: REGION_TOAST
    };
    this.render();
    this.toastTimer = setTimeout(() => {
      this.dispatch({ type: "toastExpired" });
    }, TOAST_MS);
  }

  private currentRow(): Row | undefined {
    return this.state.rows[this.state.filtered[this.state.cursor] ?? -1];
  }

  private render(): void {
    if (this.stopped) {
      return;
    }

    const size = this.driver.getSize();
    if (size.cols !== this.state.size.cols || size.rows !== this.state.size.rows) {
      this.state = step(
        this.state,
        { type: "resize", cols: size.cols, rows: size.rows },
        this.runtimeHandles
      ).state;
    }

    const nextBuffer = this.state.dirty === REGION_ALL
      ? new ScreenBuffer(this.state.size.cols, this.state.size.rows)
      : cloneBuffer(this.previousBuffer);
    renderExplorer(this.state, nextBuffer);
    this.driver.write(changesToAnsi(diff(this.previousBuffer, nextBuffer)));
    this.previousBuffer = nextBuffer;
    this.state = { ...this.state, dirty: 0 };
  }

  private track(promise: Promise<void>): void {
    this.pendingEffects.add(promise);
    promise.finally(() => {
      this.pendingEffects.delete(promise);
    });
  }

  private exit(result: R | null, after?: () => void | Promise<void>): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.unsubscribeKeypress?.();
    this.unsubscribeResize?.();
    this.detailJobs.abort();
    if (this.toastTimer !== undefined) {
      clearTimeout(this.toastTimer);
    }
    this.driver.destroy();

    Promise.resolve()
      .then(() => after?.())
      .then(() => {
        this.settle?.resolve(result);
      })
      .catch((error) => {
        this.settle?.reject(error);
      });
  }

  private fail(error: unknown): void {
    if (!this.stopped) {
      this.stopped = true;
      this.driver.destroy();
    }
    this.settle?.reject(error);
  }
}

function cloneBuffer(buffer: ScreenBuffer): ScreenBuffer {
  const next = new ScreenBuffer(buffer.width, buffer.height);
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      const cell = buffer.get(x, y);
      next.put(x, y, cell.ch, cell.style);
    }
  }
  return next;
}

function changesToAnsi(changes: Array<{ x: number; y: number; cell: ReturnType<ScreenBuffer["get"]> }>): string {
  let output = "";
  for (const change of changes) {
    output += `${cursorPositionAnsi(change.x, change.y)}${cellToAnsi(change.cell)}`;
  }
  return output;
}

function cursorPositionAnsi(x: number, y: number): string {
  return `\u001b[${Math.max(1, y + 1)};${Math.max(1, x + 1)}H`;
}
