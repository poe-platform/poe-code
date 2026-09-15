import { expect, it } from "vitest";
import { createOutputPreviewBuffer, MAX_OUTPUT_PREVIEW_CHARS } from "./output-preview.js";

it("retains paragraph breaks and complete text before truncation", () => {
  const preview = createOutputPreviewBuffer();
  preview.push("first\n");
  preview.push("");
  preview.push("\nsecond");
  expect(preview.text()).toBe("first\n\nsecond");
});

it("bounds repeated deltas and preserves the latest result", () => {
  const preview = createOutputPreviewBuffer();
  for (let index = 0; index < 20_000; index++) preview.push(`response ${index}\n`);
  preview.push("LATEST RESULT");
  const text = preview.text();
  expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_PREVIEW_CHARS);
  expect(text).toContain("Output truncated");
  expect(text).toContain("response 19999");
  expect(text.endsWith("LATEST RESULT")).toBe(true);
});

it("replaces an oversized delta with its bounded tail and keeps later Unicode text", () => {
  const preview = createOutputPreviewBuffer();
  preview.push("old text\n");
  preview.push("👩‍💻".repeat(20_000) + "\nLATEST RESULT\n");
  preview.push("café · é · 界\n");
  const text = preview.text();
  expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_PREVIEW_CHARS);
  expect(text).toContain("Output truncated");
  expect(text).not.toContain("old text");
  expect(text.endsWith("LATEST RESULT\ncafé · é · 界\n")).toBe(true);
});

it.each([1, 2, 7, 257, 16_383])("keeps surrogate pairs intact across %s-code-unit deltas and truncation", (size) => {
  const preview = createOutputPreviewBuffer();
  const input = "👩‍💻 · 界 · é\n".repeat(2_000) + "LATEST RESULT\n";
  for (let index = 0; index < input.length; index += size) preview.push(input.slice(index, index + size));
  const text = preview.text();
  expect(text.length).toBeLessThanOrEqual(MAX_OUTPUT_PREVIEW_CHARS);
  expect(text).toContain("Output truncated");
  expect(text.endsWith("LATEST RESULT\n")).toBe(true);
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
    } else {
      expect(unit >= 0xdc00 && unit <= 0xdfff).toBe(false);
    }
  }
});
