import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

const fixtures = new URL("../../safe-bash-rust/tests/fixtures/", import.meta.url);
const cases = readFileSync(new URL("pdf-groups.txt", fixtures), "utf8")
  .trim().split("\n").filter(line => !line.startsWith("#")).map(line => line.split(" "));
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} composites transparency groups and preserves ordinary Forms`, async () => {
    for (const name of new Set(cases.map(row => row[0]!))) {
      const input = new Uint8Array(readFileSync(new URL(`${name}.pdf`, fixtures)));
      const files = new Map([["input.pdf", input]]);
      const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
      expect(result.exitCode, result.stderr).toBe(0);
      const png = decodePng(files.get("page.png")!);
      for (const row of cases.filter(row => row[0] === name)) {
        const [x, y, ...rgb] = row.slice(1).map(Number);
        const at = (y! * png.width + x!) * 4;
        rgb.forEach((value, i) => expect(Math.abs(png.data[at + i]! - value), `${run.name} ${row}`).toBeLessThanOrEqual(2));
      }
    }
  });
}
