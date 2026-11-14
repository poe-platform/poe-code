import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

const fixtures = new URL("../../safe-bash-rust/tests/fixtures/indexed/", import.meta.url);
const probes = ["pixels.txt", "spec-pixels.txt"].flatMap(name => readFileSync(new URL(name, fixtures), "utf8").trim().split("\n").filter(line => !line.startsWith("#")).map(line => line.split(" ")));
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  for (const file of readdirSync(fixtures).filter(name => name.endsWith(".pdf"))) {
    it(`${run.name} Indexed image ${file}`, async () => {
      const existing = new TextEncoder().encode("existing");
      const files = new Map([["input.pdf", new Uint8Array(readFileSync(new URL(file, fixtures)))], ["page.png", existing]]);
      if (file.startsWith("bad-")) {
        let failed = false;
        try { const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files); failed = result.exitCode !== 0; }
        catch { failed = true; }
        expect(failed).toBe(true);
        expect(files.get("page.png")).toEqual(existing);
        return;
      }
      const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
      expect(result.exitCode, result.stderr).toBe(0);
      const png = decodePng(files.get("page.png")!);
      for (const row of probes.filter(row => `${row[0]}.pdf` === file)) {
        const [x, y, ...rgb] = row.slice(1).map(Number);
        const at = (y! * png.width + x!) * 4;
        rgb.forEach((value, i) => expect(Math.abs(png.data[at + i]! - value), `${file} ${row}: ${png.data.slice(at, at + 3)}`).toBeLessThanOrEqual(file === "cmyk.pdf" ? 12 : 2));
      }
    });
  }
}

for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} interpolates palette colors exactly like RGB samples`, async () => {
    const outputs = [];
    for (const name of ["interpolate", "rgb-interpolate"]) {
      const files = new Map([["input.pdf", new Uint8Array(readFileSync(new URL(`${name}.pdf`, fixtures)))]]);
      const result = await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files);
      expect(result.exitCode, result.stderr).toBe(0);
      outputs.push(files.get("page.png"));
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });
}
