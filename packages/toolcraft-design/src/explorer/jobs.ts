import type { ExplorerEvent } from "./events.js";
import type { DetailCtx, DetailItem } from "./state.js";

export const LOADING_INDICATOR_MS = 150;
export const DETAIL_DEBOUNCE_MS = 30;

export function createDetailJobs(emit: (event: ExplorerEvent) => void): {
  schedule: (
    rowId: string,
    token: number,
    items: (ctx: DetailCtx) => Promise<DetailItem[]>,
    ctx: DetailCtx
  ) => Promise<void>;
  abort: () => void;
} {
  let lastScheduleAt = 0;
  let current: {
    controller: AbortController;
    loadingTimer: ReturnType<typeof setTimeout>;
    token: number;
  } | null = null;
  const abortedTokens = new Set<number>();

  return {
    async schedule(rowId, nextToken, items, ctx) {
      if (current !== null) {
        current.controller.abort();
        clearTimeout(current.loadingTimer);
      }

      const scheduledAt = Date.now();
      const debounce = scheduledAt - lastScheduleAt < DETAIL_DEBOUNCE_MS;
      lastScheduleAt = scheduledAt;
      const controller = new AbortController();
      let finished = false;
      const loadingTimer = setTimeout(() => {
        if (!finished && !abortedTokens.has(nextToken)) {
          emit({ type: "detailLoading", rowId, token: nextToken });
        }
      }, LOADING_INDICATOR_MS);
      current = { controller, loadingTimer, token: nextToken };

      try {
        if (debounce) {
          await waitUnlessAborted(DETAIL_DEBOUNCE_MS, controller.signal);
          if (controller.signal.aborted || current?.token !== nextToken) {
            return;
          }
        }
        const loadedItems = await items({ ...ctx, signal: controller.signal });
        finished = true;
        if (!abortedTokens.has(nextToken)) {
          emit({ type: "detailLoaded", rowId, token: nextToken, items: loadedItems });
        }
      } catch (error) {
        finished = true;
        if (!abortedTokens.has(nextToken)) {
          emit({ type: "detailError", rowId, token: nextToken, error: toError(error) });
        }
      } finally {
        finished = true;
        clearTimeout(loadingTimer);
        abortedTokens.delete(nextToken);
        if (current?.controller === controller) {
          current = null;
        }
      }
    },
    abort() {
      if (current === null) {
        return;
      }

      current.controller.abort();
      clearTimeout(current.loadingTimer);
      abortedTokens.add(current.token);
      current = null;
    }
  };
}

function waitUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
