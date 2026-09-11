import { afterEach, expect, it, vi } from "vitest";
import { FinalizationRegistryState } from "./finalization-registry-state.js";

afterEach(() => vi.unstubAllGlobals());

function controlledRegistry() {
  let collected: (cell: unknown) => void;
  const registrations: unknown[] = [];
  const unregister = vi.fn(() => true);
  vi.stubGlobal("FinalizationRegistry", class {
    constructor(callback: (cell: unknown) => void) { collected = callback; }
    register(_target: unknown, cell: unknown) { registrations.push(cell); }
    unregister = unregister;
  });
  const jobs: Array<() => Promise<void>> = [];
  const cleanup = vi.fn(async (_held: unknown) => {});
  const state = new FinalizationRegistryState(cleanup, job => jobs.push(job));
  return { state, cleanup, jobs, registrations, unregister,
    collect: (index: number) => collected(registrations[index]) };
}

it("queues cleanup and removes the cell before calling guest cleanup", async () => {
  const {state,cleanup,jobs,collect} = controlledRegistry();
  const held = {value:7};
  state.register({}, held);
  cleanup.mockImplementation(async () => { expect(state.cells.size).toBe(0); });
  collect(0);
  expect(cleanup).not.toHaveBeenCalled();
  expect(state.cells.size).toBe(1);
  expect(jobs).toHaveLength(1);
  await jobs[0]!();
  expect(cleanup).toHaveBeenCalledExactlyOnceWith(held);
});

it("unregisters every matching cell, including cleanup already queued", async () => {
  const {state,cleanup,jobs,collect,unregister} = controlledRegistry();
  const token = {};
  state.register({}, "first", token);
  state.register({}, "second", token);
  state.register({}, "other", {});
  collect(0);
  expect(state.unregister(token)).toBe(true);
  expect(state.unregister(token)).toBe(false);
  expect(state.cells.size).toBe(1);
  expect(unregister).toHaveBeenCalledTimes(2);
  await jobs[0]!();
  expect(cleanup).not.toHaveBeenCalled();
});

it("disposal cancels queued and subsequent collection notices", async () => {
  const {state,cleanup,jobs,collect} = controlledRegistry();
  state.register({}, "value");
  collect(0);
  state.dispose();
  state.dispose();
  collect(0);
  expect(jobs).toHaveLength(1);
  await jobs[0]!();
  expect(cleanup).not.toHaveBeenCalled();
  expect(state.cells.size).toBe(0);
  expect(() => state.register({}, "after disposal")).toThrow();
});

it("does not swallow cleanup failures or retry the removed cell", async () => {
  const {state,cleanup,jobs,collect} = controlledRegistry();
  const failure = new Error("cleanup failed");
  cleanup.mockRejectedValue(failure);
  state.register({}, "value");
  collect(0);
  await expect(jobs[0]!()).rejects.toBe(failure);
  collect(0);
  expect(state.cells.size).toBe(0);
  expect(jobs).toHaveLength(1);
});

it("holds values strongly but stores target and token through weak references", () => {
  const {state} = controlledRegistry();
  const target = {}, token = {}, held = {value:7};
  state.register(target, held, token);
  const [cell] = state.cells;
  expect(cell!.heldValue).toBe(held);
  expect(cell!.target.deref()).toBe(target);
  expect(cell!.token?.deref()).toBe(token);
  expect(Object.values(cell!)).not.toContain(target);
  expect(Object.values(cell!)).not.toContain(token);
});

it("allows unregistering permanently reachable well-known targets", () => {
  const {state,registrations} = controlledRegistry();
  state.register(Symbol.dispose, "held", Symbol.asyncDispose);
  expect(registrations).toHaveLength(0);
  expect(state.unregister(Symbol.asyncDispose)).toBe(true);
  expect(state.cells.size).toBe(0);
});

it("does not queue duplicate notices for the same pending cell", async () => {
  const {state,cleanup,jobs,collect} = controlledRegistry();
  state.register({}, "value");
  collect(0);
  collect(0);
  expect(jobs).toHaveLength(1);
  await jobs[0]!();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("does not retain a partial cell when native registration fails", () => {
  const failure = new Error("native registration failed");
  vi.stubGlobal("FinalizationRegistry", class {
    register() { throw failure; }
    unregister() { return false; }
  });
  const state = new FinalizationRegistryState(async () => {}, () => {});
  expect(() => state.register({}, "held")).toThrow(failure);
  expect(state.cells.size).toBe(0);
});

it("queues a restored cell whose target has already been collected", async () => {
  const {state,cleanup,jobs,registrations} = controlledRegistry();
  state.register(undefined,"restored held value");
  expect(registrations).toHaveLength(0);
  expect(jobs).toHaveLength(1);
  expect(state.cells.size).toBe(1);
  await jobs[0]!();
  expect(cleanup).toHaveBeenCalledExactlyOnceWith("restored held value");
  expect(state.cells.size).toBe(0);
});
