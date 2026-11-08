import { describe, expect, it, vi } from "vitest";
import { selectViewportTail, createViewport } from "./viewport.js";

describe("viewport", () => {
  it("renders only visible tail items", () => {
    const render = vi.fn((value: number) => [value]);
    expect(selectViewportTail(Array.from({ length: 10000 }, (_, i) => i), 3, 0, render)).toEqual({ rows: [9997, 9998, 9999], offset: 0 });
    expect(render).toHaveBeenCalledTimes(3);
  });
  it("clamps an oversized wrapped-row offset with bounded visible output", () => {
    expect(selectViewportTail(["a", "b"], 3, 999, item => [item+"1", item+"2"])).toEqual({ rows: ["a1", "a2", "b1"], offset: 1 });
  });
  it("holds immutable history through retention, updates and search", () => {
    const viewport = createViewport<{ id: string; text: string }>({ capacity: 3 });
    viewport.append({ id: "a", text: "first" }); viewport.append({ id: "b", text: "second" });
    viewport.scroll(1);
    viewport.append({ id: "b", text: "replacement" });
    viewport.append({ id: "c", text: "third" }); viewport.append({ id: "d", text: "fourth" });
    expect(viewport.items().map(x => x.text)).toEqual(["first", "second"]);
    expect(viewport.unseen()).toBe(3);
    expect(viewport.find(x => x.text === "first")).toBe(0);
    viewport.follow();
    expect(viewport.items().map(x => x.id)).toEqual(["b", "c", "d"]);
    expect(viewport.unseen()).toBe(0);
  });
  it("clears obsolete held state after returning to follow", () => {
    const viewport = createViewport<{ id: string }>({ capacity: 2 });
    viewport.append({ id: "a" });viewport.scroll(5);viewport.scroll(-5);
    viewport.append({ id: "b" });expect(viewport.items()).toHaveLength(2);
    expect(viewport.offset()).toBe(0);
  });
});
