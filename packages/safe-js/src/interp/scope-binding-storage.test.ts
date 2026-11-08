import { expect, it, vi } from "vitest";

it("iterates private bindings without allocating native-call argument vectors", async () => {
  vi.resetModules();
  const apply = vi.spyOn(Reflect, "apply");
  let storage: typeof import("./scope-binding-storage.js");
  try {
    storage = await import("./scope-binding-storage.js");
  } finally {
    apply.mockRestore();
  }
  const map = new storage.ScopeBindingMap<string, number>();
  const set = new storage.ScopeBindingSet<number>();
  apply.mockClear();
  for (let index = 0; index < 32; index++) {
    map.set(String(index), index);
    set.add(index);
  }
  expect(map.size).toBe(32);
  expect(map.get("4")).toBe(4);
  expect(map.has("4")).toBe(true);
  expect(set.has(4)).toBe(true);
  expect([...map.values()]).toEqual([...set]);
  expect([...map.entries()]).toEqual([...map]);
  expect(map.delete("4")).toBe(true);
  expect(set.delete(4)).toBe(true);
  // The captured bridge counts actual argument vectors passed to native calls,
  // including the otherwise easily missed empty vector for every iterator step.
  expect(apply.mock.calls).toHaveLength(0);
});

it("preserves live map and set iteration across deletion, replacement and insertion", async () => {
  const { ScopeBindingMap, ScopeBindingSet } = await import("./scope-binding-storage.js");
  const map = new ScopeBindingMap<string, number>();
  const set = new ScopeBindingSet<number>();
  map.set("first", 1);
  map.set("second", 2);
  set.add(1);
  set.add(2);
  const entries = map.entries();
  const values = map.values();
  const members = set[Symbol.iterator]();
  expect(entries[Symbol.iterator]()).toBe(entries);
  expect(entries.next()).toEqual({ value: ["first", 1], done: false });
  expect(values.next()).toEqual({ value: 1, done: false });
  expect(members.next()).toEqual({ value: 1, done: false });
  map.set("second", 20);
  map.set("third", 3);
  map.delete("first");
  set.delete(2);
  set.add(3);
  set.add(1);
  expect([...entries]).toEqual([
    ["second", 20],
    ["third", 3]
  ]);
  expect([...values]).toEqual([20, 3]);
  expect([...members]).toEqual([3]);
  expect(entries.next()).toEqual({ value: undefined, done: true });
  expect(members.next()).toEqual({ value: undefined, done: true });
});
