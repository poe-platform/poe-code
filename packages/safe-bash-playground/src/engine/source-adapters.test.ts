import { describe, expect, it } from "vitest";
import { limitCommandBuffers } from "./buffer-limit-adapter.mjs";
import { instrumentRootState } from "./root-state-adapter.mjs";

describe("pinned browser source adapters", () => {
  it("refuses a missing or changed command buffer binding", () => {
    expect(() => limitCommandBuffers("export const other = 32 * 1024 * 1024;")).toThrow(
      "structure changed"
    );
    expect(() => limitCommandBuffers("export const bufferLimit = 16 * 1024 * 1024;")).toThrow(
      "initializer changed"
    );
  });

  it("changes the actual lexical buffer binding rather than only its export", async () => {
    const code = limitCommandBuffers(
      "export const bufferLimit = 32 * 1024 * 1024; export function current() { return bufferLimit; }"
    );
    const adapted = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    expect(adapted.bufferLimit).toBe(2 * 1024 * 1024);
    expect(adapted.current()).toBe(adapted.bufferLimit);
  });

  it("refuses shell inputs without the single expected root state", () => {
    expect(() => instrumentRootState("export class Shell {};")).toThrow("structure changed");
    expect(() =>
      instrumentRootState("export class Shell { async #execute() { const state = {}; } }")
    ).toThrow("structure changed");
  });
});
