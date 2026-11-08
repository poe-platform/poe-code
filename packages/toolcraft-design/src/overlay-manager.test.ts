import { expect, it } from "vitest";
import { createOverlayManager } from "./overlay-manager.js";

it("restores focus and aborts overlays on close", () => {
  const manager = createOverlayManager("output");
  const first = manager.open("palette"); const second = manager.open("confirm");
  expect(manager.focus()).toBe("confirm"); manager.close(); expect(second.aborted).toBe(true);
  expect(manager.focus()).toBe("palette"); manager.dispose(); expect(first.aborted).toBe(true); expect(manager.focus()).toBe("output");
});