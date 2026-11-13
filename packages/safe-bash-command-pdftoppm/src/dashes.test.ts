import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodePng } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftocairoCli } from "./index.js";

const input = readFileSync(new URL("../../safe-bash-rust/tests/fixtures/dashed.pdf", import.meta.url));
const cases = readFileSync(new URL("../../safe-bash-rust/tests/fixtures/pdf-dashes.txt", import.meta.url), "utf8").trim().split("\n").filter(line => !line.startsWith("#")).map(line => line.split(" | "));
function withContent(content: string): Uint8Array {
  content = `1 0 0 RG 4 w ${content}\n`;
  const object = Buffer.from(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  return Buffer.concat([input, object, Buffer.from(`xref\n4 1\n${String(input.length).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R /Prev 319 >>\nstartxref\n${input.length + object.length}\n%%EOF\n`)]);
}
for (const run of [runPdftoppmCli, runPdftocairoCli]) {
  it(`${run.name} renders the attached PDF as four dashes`, async () => {
    const files = new Map<string, Uint8Array>([["input.pdf", input]]);
    expect((await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).exitCode).toBe(0);
    const png = decodePng(files.get("page.png")!);
    expect([...png.data.slice((50 * 100 + 25) * 4, (50 * 100 + 25) * 4 + 3)]).toEqual([255, 255, 255]);
    let colored = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 1] !== 255) colored++;
    expect(colored).toBe(160);
  });
  it.each(cases)(`${run.name} dash case: %s`, async (_name, content, probes) => {
    const files = new Map([["input.pdf", withContent(content!)]]);
    expect((await run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).exitCode).toBe(0);
    const png = decodePng(files.get("page.png")!);
    for (const probe of probes!.split(" ")) {
      const [x, y, color] = probe.split(",");
      const at = (Number(y) * png.width + Number(x)) * 4;
      expect([...png.data.slice(at, at + 3)], probe).toEqual(color === "red" ? [255, 0, 0] : [255, 255, 255]);
    }
  });
  it(`${run.name} rejects excessive dash geometry before replacing output`, async () => {
    const existing = new Uint8Array([1, 2, 3]);
    const files = new Map([["input.pdf", withContent("[0.000000001 0.000000001] 0 d 10 50 m 90 50 l S")], ["page.png", existing]]);
    await expect(run(["-png", "-r", "72", "-singlefile", "input.pdf", "page"], files)).rejects.toThrow("limit");
    expect(files.get("page.png")).toEqual(existing);
  });
}
