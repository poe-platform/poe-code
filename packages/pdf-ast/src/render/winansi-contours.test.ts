import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument } from "../document.js";
it("preserves WinAnsi em-dash and euro contours", () => {
  const bytes = new Uint8Array(
    readFileSync(new URL("../../../safe-bash-rust/tests/fixtures/pdf-winansi.pdf", import.meta.url))
  );
  const page = PdfDocument.load(bytes).getPage(0),
    image = page.renderToBitmap({ scale: 2 });
  expect(
    page
      .evaluateDisplayList()
      .glyphs.map((g) => g.unicode)
      .join("")
  ).toBe("Café — € 50");
  for (const [name, left, right] of [
    ["em dash", 103, 126],
    ["euro", 134, 147]
  ] as const) {
    let ink = false;
    for (let y = 90; y < 109; y++)
      for (let x = left; x < right; x++) if (image.data[(y * 400 + x) * 4]! < 100) ink = true;
    expect(ink, name).toBe(true);
  }
});
