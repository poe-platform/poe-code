import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { clippingCases } from "./testing/path-clipping.js";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  for (const fixture of clippingCases) {
    it(`${run.name} clips paths: ${fixture.name}`, async () => {
      const files = new Map([["input.pdf", fixture.pdf]]);
      const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
      expect(result.exitCode).toBe(0);
      const png = decodePng(files.get("page.png")!);
      for (const [x, y, ...rgb] of fixture.probes) {
        const i = (y! * png.width + x!) * 4;
        expect([...png.data.slice(i, i + 3)]).toEqual(rgb);
      }
    });
  }
}
