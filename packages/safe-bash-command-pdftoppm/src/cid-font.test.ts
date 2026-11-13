import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

const input = readFileSync(new URL("../../safe-bash-rust/tests/fixtures/cid-truetype.pdf", import.meta.url));
const cases = JSON.parse(readFileSync(new URL("../../safe-bash-rust/tests/fixtures/cid-font-cases.json", import.meta.url), "utf8")) as {name: string; update: string; expected: string; same?: string}[];
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} retains Identity-H mappings, widths, blank glyphs and transforms`, async () => {
    const outputs = new Map<string, Uint8Array>();
    for (const {name, update, expected, same} of cases.filter(c => c.expected !== "error")) {
      const files = new Map<string, Uint8Array>([["input.pdf", Buffer.concat([input, Buffer.from(update)])]]);
      expect((await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).exitCode, name).toBe(0);
      const bytes = files.get("page.png")!;
      const png = decodePng(bytes);
      expect([png.width, png.height]).toEqual([420, 120]);
      let ink = 0;
      for (let i = 0; i < png.data.length; i += 4) if (png.data[i]! < 150) ink++;
      if (expected === "blank") expect(ink, name).toBe(0);
      else expect(ink, name).toBeGreaterThan(150);
      if (same) expect(bytes, name).toEqual(outputs.get(same));
      outputs.set(name, bytes);
    }
  });
  it.each(["invalid-font", "invalid-map-data"])(`${run.name} preserves output for %s`, async (name) => {
    const {update} = cases.find(c => c.name === name)!;
    const existing = new Uint8Array([1, 2, 3]);
    const files = new Map([["input.pdf", new Uint8Array(Buffer.concat([input, Buffer.from(update)]))], ["page.png", existing]]);
    await expect(run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).rejects.toThrow();
    expect(files.get("page.png")).toEqual(existing);
  });
}
