import { expect, test } from "vitest";
import { renderGraph, settings } from "./index.js";
test("bounds ranks, pixel allocation and Cartesian edge expansion before output", async () => {
  const limits = settings({ limits: { maxPixels: 1 } });
  await expect(renderGraph("digraph { a -> b }", "png", "dot", {}, limits)).rejects.toThrow(
    "pixel limit"
  );
  await expect(
    renderGraph("digraph { a -> b }", "svg", "dot", { edge: { minlen: "1000000000" } }, limits)
  ).rejects.toThrow("layout cost");
  await expect(
    renderGraph(
      "digraph { {a;b} -> {c;d} }",
      "svg",
      "dot",
      {},
      settings({ limits: { maxEdges: 3 } })
    )
  ).rejects.toThrow("edge limit");
});
test("spring layout keeps a three-node path compact", async () => {
  const graph = JSON.parse(
    new TextDecoder().decode(
      await renderGraph("digraph { a -> b -> c }", "json", "neato", {}, settings({}))
    )
  );
  expect(graph.width).toBeLessThan(500);
  expect(graph.height).toBeLessThan(500);
});
