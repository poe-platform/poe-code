import { expect, it } from "vitest";
import { createTaskTree } from "./task-tree.js";

it("indexes task hierarchy and collapses visible descendants", () => {
  const tree = createTaskTree(); tree.upsert({ id: "root", label: "Build", status: "running" }); tree.upsert({ id: "child", parentId: "root", label: "Test", status: "pending" });
  expect(tree.rows(0, 2).map(x => x.depth)).toEqual([0, 1]); tree.toggle("root"); expect(tree.rows(0, 2)).toHaveLength(1);
  expect(() => tree.upsert({ id: "root", parentId: "child", label: "cycle", status: "running" })).toThrow();
});
it("renders only requested task rows", () => {
  const tree = createTaskTree(); for (let i = 0; i < 10000; i++) tree.upsert({ id: String(i), label: String(i), status: "pending" });
  expect(tree.rows(9998, 1).map(x => x.id)).toEqual(["9998"]);
});

it("removes task subtrees without retaining stale state", () => {
  const tree = createTaskTree(); tree.upsert({ id: "a", label: "A", status: "running" }); tree.upsert({ id: "b", parentId: "a", label: "B", status: "pending" });
  tree.remove("a"); expect(tree.rows(0, 10)).toEqual([]);
});
it("enforces task capacity", () => {
  const tree = createTaskTree({ capacity: 1 }); tree.upsert({ id: "a", label: "A", status: "pending" });
  expect(() => tree.upsert({ id: "b", label: "B", status: "pending" })).toThrow();
});

it("renders hierarchy, status and duration within terminal width", async () => {
  const { renderTaskRows } = await import("./task-tree.js");
  expect(renderTaskRows([{ id: "a", label: "Test", status: "success", depth: 1, collapsed: false, durationMs: 20 }], 40)[0]).toBe("  ▾ ✓ Test · 20ms");
});
