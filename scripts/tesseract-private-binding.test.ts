import { expect, it, vi } from "vitest";

const { load, missingBinding } = vi.hoisted(() => {
  const missingBinding = new Error("Local OCR binding has not been built");
  return { missingBinding, load: vi.fn(() => { throw missingBinding; }) };
});

vi.mock("node:module", () => ({ createRequire: () => load }));

it("loads only the local OCR binding on demand without a public package fallback", async () => {
  const { recognize } = await import("../packages/tesseract-rust/src/index.js");
  expect(load).not.toHaveBeenCalled();
  await expect(recognize(new Uint8Array())).rejects.toBe(missingBinding);
  expect(load.mock.calls).toEqual([["./poe-tesseract.node"]]);
});
