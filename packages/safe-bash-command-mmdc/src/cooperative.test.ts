import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { renderMermaidPngAsync } from "./command.js";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";

it("yields and cancels PNG pixel work with frozen clocks", async () => {
  mock.method(performance, "now", () => 0);
  mock.method(Date, "now", () => 0);
  try {
    const controller = new AbortController();
    let turns = 0;
    registerYieldCheckpoint(controller.signal, () => {
      if (++turns === 8) setTimeout(() => controller.abort(new Error("cancel pixels")), 0);
    });
    await assert.rejects(renderMermaidPngAsync("flowchart TD\nA[Hello] --> B[World]", {
      width: 800, height: 800, signal: controller.signal
    }), /cancel pixels/);
    assert.ok(turns >= 8);
  } finally { mock.restoreAll(); }
});

import { renderMermaidPng, renderMermaidSvg } from "./command.js";
import { parseMermaid } from "./parser.js";
import { layoutMermaid } from "./layout.js";
import { rasterizeSceneSteps } from "./raster.js";
import { encodeRgbaToPngSteps } from "./png.js";
import { runWork } from "./work.js";

it("preserves PNG bytes in the cooperative SDK", async () => {
  const source = "flowchart TD\nA --> B";
  const sync = renderMermaidPng(source);
  const asyncResult = await renderMermaidPngAsync(source);
  assert.deepEqual(asyncResult, sync);
  assert.ok(renderMermaidSvg(source).svg.includes("<svg"));
});

for (const stage of ["pixels", "png"] as const) {
  it(`cancels within ${stage} work quanta with frozen clocks`, async () => {
    const scene = stage === "pixels" ? layoutMermaid(parseMermaid("flowchart TD\nA --> B"), { width: 800, height: 800 }) : undefined;
    mock.method(performance, "now", () => 0);
    mock.method(Date, "now", () => 0);
    try {
      const controller = new AbortController();
      let turns = 0;
      registerYieldCheckpoint(controller.signal, () => {
        if (++turns === 3) setTimeout(() => controller.abort(new Error("cancel stage")), 0);
      });
      const work = scene ? rasterizeSceneSteps(scene) : encodeRgbaToPngSteps(new Uint8Array(800 * 800 * 4), 800, 800);
      await assert.rejects(runWork<unknown>(work, controller.signal), /cancel stage/);
      assert.ok(turns >= 3);
    } finally { mock.restoreAll(); }
  });
}
