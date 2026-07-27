import { Screen } from "../screen/screen.js";
import { appendFileSync } from "node:fs";
import { createTerminalDriver, type TerminalDriver } from "../terminal/driver.js";
import { type ActionRuntimeHandles } from "./actions.js";
import { type Effect, type ExplorerEvent } from "./events.js";
import { createDetailJobs } from "./jobs.js";
import { computeExplorerLayout } from "./layout.js";
import { renderExplorer } from "./render/index.js";
import { step } from "./reducer.js";
import {
  createInitialState,
  REGION_ALL,
  REGION_FOOTER,
  REGION_MODAL,
  REGION_TOAST,
  type ExplorerConfig,
  type ConfirmPromptOptions,
  type NormalizedExplorerConfig,
  type ExplorerState,
  type Row,
  type Tone,
  normalizeExplorerConfig
} from "./state.js";

const TOAST_MS = 2500;

export async function runExplorer<R = void>(config: ExplorerConfig<R>): Promise<R | null> {
  if (process.stdout.isTTY !== true) {
    throw new Error("explorer requires a TTY");
  }

  const driver = createTerminalDriver({ mouse: config.mouse });
  const runtime = new ExplorerRuntime(config, driver);
  return runtime.run();
}

class ExplorerRuntime<R> {
  private readonly config: NormalizedExplorerConfig<R>;
  private state: ExplorerState;
  private readonly screen: Screen;
  private readonly detailJobs;
  private readonly runtimeHandles: ActionRuntimeHandles;
  private readonly pendingEffects = new Set<Promise<void>>();
  private unsubscribeKeypress: (() => void) | undefined;
  private unsubscribeResize: (() => void) | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private rowsRequestToken = 0;
  private reorderToken = 0;
  private stopped = false;
  private renderScheduled = false;
  private readonly tracePath = process.env.POE_CODE_TUI_TRACE;
  private settle:
    | { resolve: (value: R | null) => void; reject: (error: unknown) => void }
    | undefined;

  constructor(
    config: ExplorerConfig<R>,
    private readonly driver: TerminalDriver
  ) {
    this.config = normalizeExplorerConfig(config);
    this.state = createInitialState(this.config, driver.getSize());
    this.screen = new Screen(driver.getSize());
    this.detailJobs = createDetailJobs((event) => {
      if (event.type === "detailLoaded") {
        this.loadDetailContent(event.rowId, event.token, event.items);
        return;
      }
      this.dispatch(event);
    });
    this.runtimeHandles = {
      refresh: async () => {
        await this.refreshRowsFromSource();
      },
      reloadDetail: (rowId) => {
        this.reloadFocusedDetail(rowId);
      },
      suspendAnd: async (fn) => this.suspendAnd(fn),
      openModal: (content) => {
        this.dispatch({ type: "modalOpened", title: content.title, content: content.content });
      },
      toast: (msg, tone) => {
        this.showToast(msg, tone);
      },
      confirm: async (prompt) => this.confirm(prompt),
      promptText: async (options) => this.promptText(options),
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
        if (this.config.initialRows !== undefined && this.config.initialRows.length > 0) {
          // Seed list/detail before first paint so callers with known rows avoid an empty flash.
          this.dispatch({ type: "rowsLoaded", rows: this.config.initialRows });
        }
        this.renderNow();
        this.loadRows().catch((error) => {
          this.fail(error);
        });
      } catch (error) {
        this.fail(error);
      }
    });
  }

  private startTerminal(): void {
    this.driver.start();

    this.subscribeKeypress();
    this.unsubscribeResize = this.driver.onResize((size) => {
      this.dispatch({ type: "resize", cols: size.cols, rows: size.rows });
    });
  }

  private subscribeKeypress(): void {
    if (this.unsubscribeKeypress !== undefined) {
      return;
    }

    this.unsubscribeKeypress = this.driver.onEvent((event) => {
      this.trace("input", { event });
      if (event.type === "paste") {
        for (const ch of event.text.replaceAll("\n", "").replaceAll("\r", "")) {
          this.dispatch({
            type: "key",
            key: { ch, name: ch, ctrl: false, meta: false, shift: false }
          });
        }
        return;
      }
      if (event.type === "wheel") {
        this.dispatch({
          type: "key",
          key: { name: event.direction, ctrl: false, meta: false, shift: false }
        });
        return;
      }
      this.dispatch({
        type: "key",
        key: {
          name: event.name,
          ch: event.ch,
          ctrl: event.ctrl,
          meta: event.alt,
          shift: event.shift
        }
      });
    });
  }

  private pauseKeypress(): void {
    this.unsubscribeKeypress?.();
    this.unsubscribeKeypress = undefined;
  }

  private async loadRows(requestToken = ++this.rowsRequestToken): Promise<void> {
    const rows = await this.config.rows();
    if (requestToken === this.rowsRequestToken) {
      this.dispatch({ type: "rowsLoaded", rows });
    }
  }

  private async refreshRowsFromSource(): Promise<void> {
    const requestToken = ++this.rowsRequestToken;
    await this.config.refresh?.();
    await this.loadRows(requestToken);
  }

  private dispatch(event: ExplorerEvent): void {
    if (this.stopped) {
      return;
    }

    const previousState = this.state;
    const next = step(this.state, event, this.runtimeHandles);
    this.state = next.state;
    this.scheduleRender();
    this.applyEffects(next.effects, previousState);
  }

  private applyEffects(effects: Effect[], previousState: ExplorerState): void {
    for (const effect of effects) {
      if (effect.type === "renderDetail") {
        this.renderDetail(effect.rowId, effect.token);
        continue;
      }

      if (effect.type === "persistOrder") {
        this.track(this.persistOrder(effect.orderedIds, previousState.rows, ++this.reorderToken));
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

  private renderDetail(rowId: string, token: number): void {
    const row = this.state.rows.find((candidate) => candidate.id === rowId);
    if (row === undefined) {
      return;
    }

    const layout = computeExplorerLayout({
      cols: this.state.size.cols,
      rows: this.state.size.rows,
      detailHidden: this.state.layout === "narrow-list-only" || this.state.layout === "too-narrow",
      focused: this.state.focused
    });

    const reloadDetail = () => this.reloadFocusedDetail(rowId);
    void this.detailJobs.schedule(
      rowId,
      token,
      (ctx) => this.config.detail.items(row, { ...ctx, reloadDetail }),
      {
        width: layout.detail.width,
        height: layout.detail.height,
        row,
        signal: new AbortController().signal,
        reloadDetail
      }
    );
  }

  private reloadFocusedDetail(rowId?: string): void {
    const focusedId = this.state.detail.rowId;
    if (focusedId === null) {
      return;
    }
    if (rowId !== undefined && rowId !== focusedId) {
      return;
    }
    const token = this.state.detail.token + 1;
    this.state = { ...this.state, detail: { ...this.state.detail, token } };
    this.renderDetail(focusedId, token);
  }

  private loadDetailContent(
    rowId: string,
    token: number,
    items: import("./state.js").DetailItem[]
  ): void {
    const row = this.state.rows.find((candidate) => candidate.id === rowId);
    if (row === undefined) {
      return;
    }

    const layout = computeExplorerLayout({
      cols: this.state.size.cols,
      rows: this.state.size.rows,
      detailHidden: this.state.layout === "narrow-list-only" || this.state.layout === "too-narrow",
      focused: this.state.focused
    });
    const context = {
      width: layout.detail.width,
      height: layout.detail.height,
      row,
      signal: new AbortController().signal
    };

    const preparedItems = items.map((item, itemIndex) => {
      try {
        const content = item.render(context);
        if (typeof content === "string") {
          return { ...item, renderedContent: content };
        }
        this.track(
          content.then(
            (resolved) =>
              this.dispatch({
                type: "detailItemRendered",
                rowId,
                token,
                itemIndex,
                content: resolved
              }),
            (error) =>
              this.dispatch({
                type: "detailItemRendered",
                rowId,
                token,
                itemIndex,
                content: error instanceof Error ? `Error: ${error.message}` : "Error: detail failed"
              })
          )
        );
        return { ...item, renderedContent: "Loading detail..." };
      } catch (error) {
        return {
          ...item,
          renderedContent:
            error instanceof Error ? `Error: ${error.message}` : "Error: detail failed"
        };
      }
    });
    this.dispatch({ type: "detailLoaded", rowId, token, items: preparedItems });
  }

  private async persistOrder(
    orderedIds: string[],
    previousRows: Row[],
    token: number
  ): Promise<void> {
    try {
      await this.config.reorder?.onReorder(orderedIds, {
        refresh: this.runtimeHandles.refresh,
        toast: this.runtimeHandles.toast
      });
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : "Could not persist order", "error");
      if (token === this.reorderToken) {
        this.dispatch({ type: "rowsLoaded", rows: previousRows });
      }
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
    this.pauseKeypress();
    this.state = { ...this.state, suspended: true };
    this.driver.stop();

    try {
      return await fn();
    } finally {
      if (!this.stopped) {
        this.driver.start();
        this.state = { ...this.state, suspended: false };
        this.subscribeKeypress();
        const size = this.driver.getSize();
        this.dispatch({
          type: "suspendResumed",
          value: null,
          emit: { type: "resize", cols: size.cols, rows: size.rows }
        });
      }
    }
  }

  private confirm(prompt: string | ConfirmPromptOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const options = typeof prompt === "string"
        ? { title: "Confirm", message: prompt }
        : prompt;
      this.state = {
        ...this.state,
        modal: {
          kind: "confirm",
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? "Yes",
          cancelLabel: options.cancelLabel ?? "No",
          destructive: options.destructive ?? false,
          resolver: resolve
        },
        dirty: REGION_MODAL | REGION_FOOTER
      };
      this.scheduleRender();
    });
  }

  private promptText(options: {
    title: string;
    label: string;
    initialValue?: string;
    placeholder?: string;
  }): Promise<string | null> {
    return new Promise((resolve) => {
      this.state = {
        ...this.state,
        modal: {
          kind: "input",
          title: options.title,
          label: options.label,
          value: options.initialValue ?? "",
          placeholder: options.placeholder,
          resolver: resolve
        },
        dirty: REGION_MODAL | REGION_FOOTER
      };
      this.scheduleRender();
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
    this.scheduleRender();
    this.toastTimer = setTimeout(() => {
      this.dispatch({ type: "toastExpired" });
    }, TOAST_MS);
  }

  private currentRow(): Row | undefined {
    return this.state.rows[this.state.filtered[this.state.cursor] ?? -1];
  }

  private scheduleRender(): void {
    if (this.stopped || this.state.suspended || this.renderScheduled) {
      return;
    }
    this.renderScheduled = true;
    setImmediate(() => {
      this.renderScheduled = false;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.stopped || this.state.suspended) return;

    const size = this.driver.getSize();
    if (size.cols !== this.state.size.cols || size.rows !== this.state.size.rows) {
      this.state = step(
        this.state,
        { type: "resize", cols: size.cols, rows: size.rows },
        this.runtimeHandles
      ).state;
    }

    if (this.screen.width !== this.state.size.cols || this.screen.height !== this.state.size.rows)
      this.screen.resize(this.state.size);
    renderExplorer({ ...this.state, dirty: REGION_ALL }, this.screen);
    const frame = this.screen.flush();
    this.driver.writeFrame(frame);
    this.trace("frame", {
      bytes: Buffer.byteLength(frame),
      cols: this.state.size.cols,
      rows: this.state.size.rows
    });
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
    this.driver.stop();

    Promise.allSettled([...this.pendingEffects])
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
      this.driver.stop();
    }
    this.settle?.reject(error);
  }

  private trace(type: string, fields: Record<string, unknown>): void {
    if (this.tracePath === undefined || this.tracePath.length === 0) return;
    appendFileSync(
      this.tracePath,
      `${JSON.stringify({ type, timestamp: new Date().toISOString(), ...fields })}\n`
    );
  }
}
