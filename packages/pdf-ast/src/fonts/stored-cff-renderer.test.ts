import { expect, it } from "vitest";
import { Type2Compiled } from "../vendor/pdfjs-fonts.mjs";
import { createStoredCffRenderer } from "./stored-cff-renderer.js";
it("reuses caller-backed operands for sequential glyphs", async () => {
  const data = new Uint8Array(65536);
  let end = 0;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      return data.slice(at, at + n);
    },
    async write(at: number, bytes: Uint8Array) {
      data.set(bytes, at);
    }
  };
  const code = Uint8Array.of(139, 139, 21, 140, 139, 5, 14),
    native = new Type2Compiled({ glyphs: [code] }, [], [1, 0, 0, 1, 0, 0]);
  const render = createStoredCffRenderer(native, async () => code, storage);
  let previous = 0;
  for (let i = 0; i < 3; i++) {
    const path = [];
    for await (const segment of render(0)) path.push(segment);
    expect(path).toEqual([
      { kind: "move", x: 0, y: 0 },
      { kind: "line", x: 1, y: 0 },
      { kind: "close" }
    ]);
    if (previous) expect(end).toBe(previous);
    previous = end;
  }
});
