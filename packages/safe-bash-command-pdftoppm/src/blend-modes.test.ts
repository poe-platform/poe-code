import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

const input = readFileSync(new URL("../../safe-bash-rust/tests/fixtures/blend-modes.pdf", import.meta.url));
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} blends paths, strokes, images, shading and glyphs with alpha and scoped state`, async () => {
    const files = new Map<string, Uint8Array>([["input.pdf", input]]);
    const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    const png = decodePng(files.get("page.png")!);
    for (const [row, blend] of [[0,0,255], [0,0,0], [255,0,255], [255,0,255]].entries()) {
      const y = 85 - row * 20;
      for (const [column, x] of [8,28,48,68,84,108,128,148,168,188].entries()) {
        const expected = column === 5 ? [255,0,255] : column === 7 ? [(255+blend[0]!)/2,0,blend[2]!/2] : column === 8 ? [0,0,255] : blend;
        const pixel = png.data.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3);
        expected.forEach((v,i) => expect(Math.abs(pixel[i]! - v), `${x},${y}: ${pixel}`).toBeLessThanOrEqual(2));
      }
    }
    expect([...png.data.slice((5*200+8)*4, (5*200+8)*4+3)]).toEqual([0,255,0]);
  });
  it(`${run.name} rejects malformed or unsupported blend state without replacing output`, async () => {
    for (const value of ["/Unknown ", "123456789", "[]       ", "[/Bad]   ", "null     ", "9 0 R    ", "[/Bad 1] "]) {
      const invalid = Buffer.from(input.toString("latin1").replace("/BM /Multiply", `/BM ${value}`), "latin1");
      const existing = new Uint8Array([1,2,3]);
      const files = new Map([["input.pdf", invalid], ["page.png", existing]]);
      await expect(run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).rejects.toThrow("PDF blend mode");
      expect(files.get("page.png")).toEqual(existing);
    }
  });
}

it.each([runPdftoppmCli, runPdftocairoCli])("%s accepts blend-mode arrays", async run => {
  const bytes = Buffer.from(input.toString("latin1").replace("/BM /Difference", "/BM [/Multiply]"), "latin1");
  const files = new Map<string, Uint8Array>([["input.pdf", bytes]]);
  expect((await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).exitCode).toBe(0);
  const png = decodePng(files.get("page.png")!);
  expect([...png.data.slice((25*200+8)*4, (25*200+8)*4+3)]).toEqual([0,0,0]);
});
