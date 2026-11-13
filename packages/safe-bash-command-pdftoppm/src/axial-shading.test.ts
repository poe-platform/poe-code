import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { shadingCases } from "../../safe-bash-rust/tests/fixtures/axial-shading.mjs";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  for (const { name, pdf, probes } of shadingCases) {
    it(`${run.name}: axial shading ${name}`, async () => {
      const files = new Map([["input.pdf", pdf]]);
      const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
      expect(result.exitCode, result.stderr).toBe(0);
      const png = decodePng(files.get("page.png")!);
      for (const [x, y, ...expected] of probes) {
        const pixel = png.data.slice((y! * 100 + x!) * 4, (y! * 100 + x!) * 4 + 3);
        expected.forEach((v, i) => expect(Math.abs(pixel[i]! - v), `${x},${y}: ${pixel}`).toBeLessThanOrEqual(3));
      }
    });
  }
}
