import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MermaidError } from "./contracts.js";
import { layoutMermaid } from "./layout.js";
import { parseMermaid } from "./parser.js";
import { decodePngToRgba, encodeRgbaToPng } from "./png.js";
import { rasterizeScene } from "./raster.js";
import { serializeSceneToSvg } from "./svg.js";

describe("SVG serializer, 4x4 subpixel rasterizer, and RFC 2083 PNG codec", () => {
  it("serializes valid escaped SVG with elevation shadow filter, dart markers, and viewBox, and blocks <script>", () => {
    assert.throws(
      () => parseMermaid(`flowchart LR\nA([Start <script>]) --> B`),
      (err: unknown) => err instanceof MermaidError && err.code === "E_UNSUPPORTED"
    );

    const doc = parseMermaid(`
      flowchart LR
        A(["Start x < y & y > z"]) -->|Check & Verify| B{Decision?}
        B -->|OK| C[Done]
    `);
    const scene = layoutMermaid(doc, { theme: "light" });
    const svg = serializeSceneToSvg(scene);

    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes(`viewBox="0 0 ${scene.viewBox.width} ${scene.viewBox.height}"`));
    assert.ok(svg.includes("M 0 0 L 9 3.5 L 0 7 L 2.2 3.5 Z"));
    assert.ok(svg.includes("Start x &lt; y &amp; y &gt; z"));
    assert.ok(svg.includes("Check &amp; Verify"));
  });

  it("encodes and decodes RGBA framebuffers via RFC 2083 PNG with valid CRC32 and Adler32", () => {
    const width = 16;
    const height = 12;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = (i * 7) & 0xff;
      rgba[i * 4 + 1] = (i * 13) & 0xff;
      rgba[i * 4 + 2] = (i * 29) & 0xff;
      rgba[i * 4 + 3] = 255;
    }
    const png = encodeRgbaToPng(rgba, width, height);
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

    const decoded = decodePngToRgba(png);
    assert.equal(decoded.width, width);
    assert.equal(decoded.height, height);
    assert.deepEqual(decoded.rgba, rgba);
  });

  it("rasterizes MermaidScene at 2x scale with background fidelity and 4x4 subpixel antialiasing", () => {
    const doc = parseMermaid(`
      flowchart TD
        Start([Begin]) --> Check{Ready?}
        Check -->|Yes| End[Finish]
    `);
    const lightScene = layoutMermaid(doc, { theme: "light" });
    const raster = rasterizeScene(lightScene, { scale: 2 });
    assert.equal(raster.width, Math.ceil(lightScene.width * 2));
    assert.equal(raster.height, Math.ceil(lightScene.height * 2));

    // Top-left corner pixel (2, 2) must match light canvas #f8fafc (248, 250, 252, 255)
    const idx = (2 * raster.width + 2) * 4;
    assert.equal(raster.rgba[idx], 248);
    assert.equal(raster.rgba[idx + 1], 250);
    assert.equal(raster.rgba[idx + 2], 252);
    assert.equal(raster.rgba[idx + 3], 255);

    // Transparent background check
    const transScene = layoutMermaid(doc, { theme: "dark", backgroundColor: "transparent" });
    const transRaster = rasterizeScene(transScene, { scale: 2 });
    assert.equal(transRaster.rgba[3], 0);

    // Verify intermediate antialiased pixel blends exist (not 1-bit staircase)
    let intermediateBlendCount = 0;
    for (let i = 0; i < transRaster.rgba.length; i += 4) {
      const alpha = transRaster.rgba[i + 3]!;
      if (alpha > 0 && alpha < 255) intermediateBlendCount++;
    }
    assert.ok(
      intermediateBlendCount > 100,
      `Expected > 100 antialiased intermediate alpha pixels, got ${intermediateBlendCount}`
    );
  });
});
