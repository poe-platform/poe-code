import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { runPdftoppmCli, runPdftoppmCliSync } from "./index.js";

const doc = PdfDocument.create();
doc.addPage([2, 2]);
doc.addPage([2, 2]);
doc.addPage([2, 2]);
const pdf = doc.save();
const validArgs = ["in.pdf", "out"];
const invalidArgs: string[][] = [
  ["-unknown-flag", ...validArgs],
  ["-png", "-odd", ...validArgs],
  ["-png", "-even", ...validArgs],
  [...validArgs, "extra"],

];
for (const flag of ["-r", "-rx", "-ry", "-scale-to", "-scale-to-x", "-scale-to-y", "-f", "-l", "-x", "-y", "-W", "-H", "-sz", "-setpageno"]) {
  for (const value of ["abc", "1abc", "NaN", "Infinity", "0x10", " 2", "2 "]) {
    invalidArgs.push([flag, value, ...validArgs]);
  }
  invalidArgs.push([flag]);
}
for (const flag of ["-scale-to", "-scale-to-x", "-scale-to-y", "-f", "-l", "-x", "-y", "-W", "-H", "-sz", "-setpageno"]) {
  invalidArgs.push([flag, "1.5", ...validArgs], [flag, "1e2", ...validArgs]);
}
it.each(invalidArgs)("rejects invalid arguments %j before reading or writing PDFs", async (...args) => {
  for (const run of [runPdftoppmCli, runPdftoppmCliSync]) {
    const files = new Map([["in.pdf", pdf]]);
    const result = await run(args, files);
    expect(result.exitCode).toBe(99);
    expect(result.stderr).not.toBe("");
    expect([...files.keys()]).toEqual(["in.pdf"]);
    expect((await run(args, new Map())).exitCode).toBe(99);
  }
});
it.each([
  { flag: "-o", outputs: ["out-1.png", "out-3.png"] },
  { flag: "-e", outputs: ["out-2.png"] },
])("filters pages with $flag", async ({ flag, outputs }) => {
  for (const run of [runPdftoppmCli, runPdftoppmCliSync]) {
    const files = new Map([["in.pdf", pdf]]);
    const result = await run(["-png", flag, ...validArgs], files);
    expect(result.exitCode).toBe(0);
    expect([...files.keys()]).toEqual(["in.pdf", ...outputs]);
  }
});
it("identifies an empty PDF stream", async () => {
  const result = await runPdftoppmCli(["-"], new Map([["-", new Uint8Array()]]));
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Syntax Error: Document stream is empty");
});
