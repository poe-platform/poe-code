import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { step } from "./reducer.js";
import { createDetailJobs, DETAIL_DEBOUNCE_MS, LOADING_INDICATOR_MS } from "./jobs.js";
import {
  createInitialState,
  type DetailCtx,
  type DetailItem,
  type ExplorerConfig
} from "./state.js";
import type { ExplorerEvent } from "./events.js";

function config(overrides: Partial<ExplorerConfig<unknown>> = {}): ExplorerConfig<unknown> {
  return {
    title: "Plans",
    rows: async () => [],
    detail: { items: async () => [] },
    actions: [],
    ...overrides
  };
}

function detailCtx(rowId: string): DetailCtx {
  return {
    width: 40,
    height: 10,
    row: { id: rowId, title: rowId },
    signal: new AbortController().signal
  };
}

function detailItem(id: string): DetailItem {
  return { id, render: () => "" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("createDetailJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("assigns monotonic tokens and lets the reducer drop stale detail results", async () => {
    const events: ExplorerEvent[] = [];
    const jobs = createDetailJobs((event) => events.push(event));
    const first = deferred<DetailItem[]>();
    const second = deferred<DetailItem[]>();

    const firstJob = jobs.schedule("one", () => first.promise, detailCtx("one"));
    const secondJob = jobs.schedule("two", () => second.promise, detailCtx("two"));
    first.resolve([detailItem("first")]);
    second.resolve([detailItem("second")]);
    await vi.advanceTimersByTimeAsync(DETAIL_DEBOUNCE_MS);
    await Promise.all([firstJob, secondJob]);

    expect(
      events.map((event) => ({
        ...event,
        items: event.type === "detailLoaded" ? event.items.map((item) => item.id) : undefined
      }))
    ).toEqual([
      { type: "detailLoaded", rowId: "one", token: 1, items: ["first"] },
      { type: "detailLoaded", rowId: "two", token: 2, items: ["second"] }
    ]);

    const loaded = step(createInitialState(config(), { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [{ id: "two", title: "Two" }]
    }).state;
    const current = { ...loaded, detail: { ...loaded.detail, rowId: "two", token: 2 } };
    const stale = step(current, events[0] as Extract<ExplorerEvent, { type: "detailLoaded" }>);
    const fresh = step(current, events[1] as Extract<ExplorerEvent, { type: "detailLoaded" }>);

    expect(stale.state.detail.items).toBeNull();
    expect(fresh.state.detail.items?.map((item) => item.id)).toEqual(["second"]);
  });

  it("aborts the previous schedule when a new detail job starts", async () => {
    const jobs = createDetailJobs(() => undefined);
    const first = deferred<DetailItem[]>();
    let firstSignal: AbortSignal | undefined;

    const firstJob = jobs.schedule(
      "one",
      (ctx) => {
        firstSignal = ctx.signal;
        return first.promise;
      },
      detailCtx("one")
    );
    const secondJob = jobs.schedule("two", () => Promise.resolve([]), detailCtx("two"));

    expect(firstSignal?.aborted).toBe(true);
    first.resolve([]);
    await vi.advanceTimersByTimeAsync(DETAIL_DEBOUNCE_MS);
    await Promise.all([firstJob, secondJob]);
  });

  it("debounces rapid successive schedules so intermediate rows never load", async () => {
    const jobs = createDetailJobs(() => undefined);
    const ran: string[] = [];
    const load = (id: string) => () => {
      ran.push(id);
      return Promise.resolve([detailItem(id)]);
    };

    const jobsInFlight = [
      jobs.schedule("one", load("one"), detailCtx("one")),
      jobs.schedule("two", load("two"), detailCtx("two")),
      jobs.schedule("three", load("three"), detailCtx("three"))
    ];
    await vi.advanceTimersByTimeAsync(DETAIL_DEBOUNCE_MS);
    await Promise.all(jobsInFlight);

    expect(ran).toEqual(["one", "three"]);
  });

  it("emits a loading event only after the 150ms loading delay", async () => {
    const events: ExplorerEvent[] = [];
    const jobs = createDetailJobs((event) => events.push(event));
    const pending = deferred<DetailItem[]>();

    const job = jobs.schedule("one", () => pending.promise, detailCtx("one"));
    await vi.advanceTimersByTimeAsync(LOADING_INDICATOR_MS - 1);
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{ type: "detailLoading", rowId: "one", token: 1 }]);

    pending.resolve([detailItem("done")]);
    await job;

    expect(
      events.map((event) => ({
        ...event,
        items: event.type === "detailLoaded" ? event.items.map((item) => item.id) : undefined
      }))
    ).toEqual([
      { type: "detailLoading", rowId: "one", token: 1, items: undefined },
      { type: "detailLoaded", rowId: "one", token: 1, items: ["done"] }
    ]);
  });

  it("does not emit loading for detail work that finishes before the delay", async () => {
    const events: ExplorerEvent[] = [];
    const jobs = createDetailJobs((event) => events.push(event));

    await jobs.schedule("one", () => Promise.resolve([detailItem("done")]), detailCtx("one"));
    await vi.advanceTimersByTimeAsync(LOADING_INDICATOR_MS);

    expect(
      events.map((event) => ({
        ...event,
        items: event.type === "detailLoaded" ? event.items.map((item) => item.id) : undefined
      }))
    ).toEqual([{ type: "detailLoaded", rowId: "one", token: 1, items: ["done"] }]);
  });

  it("clears pending loading work when aborted", async () => {
    const events: ExplorerEvent[] = [];
    const jobs = createDetailJobs((event) => events.push(event));
    const pending = deferred<DetailItem[]>();

    const job = jobs.schedule("one", () => pending.promise, detailCtx("one"));
    jobs.abort();
    await vi.advanceTimersByTimeAsync(LOADING_INDICATOR_MS);
    pending.resolve([detailItem("done")]);
    await job;

    expect(events).toEqual([]);
  });

  it("emits detail errors with the active token", async () => {
    const events: ExplorerEvent[] = [];
    const jobs = createDetailJobs((event) => events.push(event));
    const error = new Error("failed");

    await jobs.schedule("one", () => Promise.reject(error), detailCtx("one"));

    expect(events).toEqual([{ type: "detailError", rowId: "one", token: 1, error }]);
  });
});
